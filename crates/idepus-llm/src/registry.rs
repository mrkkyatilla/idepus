use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::credentials::{has_api_key, store_api_key};
use crate::error::LLMError;
use crate::provider::LLMProvider;
use crate::providers::{AnthropicProvider, OpenAIProvider};
use crate::types::{ProviderConfig, ProviderInfo, StoredConfig, TaskMetadata};

pub struct ProviderRegistry {
    inner: Mutex<RegistryInner>,
}

struct RegistryInner {
    config: StoredConfig,
    openai: Arc<OpenAIProvider>,
    anthropic: Arc<AnthropicProvider>,
}

impl ProviderRegistry {
    pub fn new() -> Result<Self, LLMError> {
        let mut config = load_config().unwrap_or_default();
        migrate_legacy_api_key(&mut config)?;
        migrate_deprecated_models(&mut config)?;
        migrate_removed_local_provider(&mut config)?;

        Ok(Self {
            inner: Mutex::new(RegistryInner {
                config,
                openai: Arc::new(OpenAIProvider::new()),
                anthropic: Arc::new(AnthropicProvider::new()),
            }),
        })
    }

    pub fn list_providers(&self) -> Vec<ProviderInfo> {
        vec![
            ProviderInfo {
                id: "openai".into(),
                name: "OpenAI".into(),
                requires_api_key: true,
                default_model: "gpt-4o-mini".into(),
            },
            ProviderInfo {
                id: "anthropic".into(),
                name: "Anthropic".into(),
                requires_api_key: true,
                default_model: "claude-sonnet-4-6".into(),
            },
        ]
    }

    pub fn get_active_config(&self) -> ProviderConfig {
        let guard = self.inner.lock().expect("registry lock");
        let id = guard.config.active_provider_id.clone();
        let model = guard.model_for(&id);
        ProviderConfig {
            provider_id: id.clone(),
            model,
            has_api_key: has_api_key(&id),
        }
    }

    pub fn set_active_provider(
        &self,
        provider_id: &str,
        model: Option<String>,
        api_key: Option<String>,
    ) -> Result<ProviderConfig, LLMError> {
        if !matches!(provider_id, "openai" | "anthropic") {
            return Err(LLMError::UnknownProvider(provider_id.into()));
        }

        let mut guard = self.inner.lock().expect("registry lock");
        guard.config.active_provider_id = provider_id.to_string();

        if let Some(m) = model {
            match provider_id {
                "openai" => guard.config.openai_model = m,
                "anthropic" => guard.config.anthropic_model = m,
                _ => {}
            }
        }

        if let Some(key) = api_key {
            store_api_key(provider_id, &key)?;
        }

        save_config(&guard.config)?;

        let id = guard.config.active_provider_id.clone();
        let model = guard.model_for(&id);
        Ok(ProviderConfig {
            provider_id: id.clone(),
            model,
            has_api_key: has_api_key(&id),
        })
    }

    pub fn active_provider(&self) -> Result<Arc<dyn LLMProvider>, LLMError> {
        let guard = self.inner.lock().expect("registry lock");
        let id = guard.config.active_provider_id.as_str();
        let provider: Arc<dyn LLMProvider> = match id {
            "openai" => guard.openai.clone(),
            "anthropic" => guard.anthropic.clone(),
            other => return Err(LLMError::UnknownProvider(other.into())),
        };
        Ok(provider)
    }

    pub fn active_generate_options(&self) -> GenerateOptions {
        let guard = self.inner.lock().expect("registry lock");
        GenerateOptions {
            model: guard.model_for(&guard.config.active_provider_id),
            temperature: None,
            max_tokens: None,
        }
    }

    pub fn route_task(&self, _metadata: &TaskMetadata) -> Option<String> {
        None
    }
}

impl RegistryInner {
    fn model_for(&self, provider_id: &str) -> String {
        match provider_id {
            "openai" => self.config.openai_model.clone(),
            "anthropic" => self.config.anthropic_model.clone(),
            _ => String::new(),
        }
    }
}

use crate::types::GenerateOptions;

fn config_dir() -> Result<PathBuf, LLMError> {
    let home = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
        .ok_or_else(|| LLMError::Config("cannot resolve config dir".into()))?;
    Ok(home.join("idepus"))
}

fn config_path() -> Result<PathBuf, LLMError> {
    Ok(config_dir()?.join("llm.json"))
}

fn load_config() -> Option<StoredConfig> {
    let path = config_path().ok()?;
    let data = fs::read_to_string(path).ok()?;

    if let Ok(config) = serde_json::from_str::<StoredConfig>(&data) {
        return Some(config);
    }

    #[derive(serde::Deserialize)]
    struct LegacyConfig {
        provider: String,
        #[serde(default)]
        api_key: Option<String>,
        #[serde(default = "default_openai_model")]
        openai_model: String,
        #[serde(default = "default_anthropic_model")]
        anthropic_model: String,
    }

    fn default_openai_model() -> String {
        "gpt-4o-mini".into()
    }
    fn default_anthropic_model() -> String {
        "claude-sonnet-4-6".into()
    }

    serde_json::from_str::<LegacyConfig>(&data)
        .ok()
        .map(|legacy| StoredConfig {
            active_provider_id: legacy.provider,
            openai_model: legacy.openai_model,
            anthropic_model: legacy.anthropic_model,
            api_key: legacy.api_key,
        })
}

fn save_config(config: &StoredConfig) -> Result<(), LLMError> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| LLMError::Config(e.to_string()))?;
    }
    let mut to_save = config.clone();
    to_save.api_key = None;
    let data =
        serde_json::to_string_pretty(&to_save).map_err(|e| LLMError::Config(e.to_string()))?;
    fs::write(path, data).map_err(|e| LLMError::Config(e.to_string()))?;
    Ok(())
}

fn migrate_deprecated_models(config: &mut StoredConfig) -> Result<(), LLMError> {
    const DEPRECATED_ANTHROPIC: &[&str] = &[
        "claude-sonnet-4-20250514",
        "claude-opus-4-20250514",
    ];
    if DEPRECATED_ANTHROPIC.contains(&config.anthropic_model.as_str()) {
        config.anthropic_model = "claude-sonnet-4-6".into();
        save_config(config)?;
    }
    Ok(())
}

fn migrate_removed_local_provider(config: &mut StoredConfig) -> Result<(), LLMError> {
    if config.active_provider_id == "ollama" {
        config.active_provider_id = "openai".into();
        save_config(config)?;
    }
    Ok(())
}

fn migrate_legacy_api_key(config: &mut StoredConfig) -> Result<(), LLMError> {
    if let Some(key) = config.api_key.take() {
        if !key.trim().is_empty() {
            let provider = match config.active_provider_id.as_str() {
                "ollama" => "openai",
                other => other,
            };
            let _ = store_api_key(provider, &key);
        }
        save_config(config)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_lists_cloud_providers() {
        let registry = ProviderRegistry::new().unwrap();
        assert_eq!(registry.list_providers().len(), 2);
    }

    #[test]
    fn switch_active_provider() {
        let registry = ProviderRegistry::new().unwrap();
        registry
            .set_active_provider("anthropic", Some("claude-sonnet-4-6".into()), None)
            .unwrap();
        assert_eq!(registry.get_active_config().provider_id, "anthropic");
        assert_eq!(
            registry.get_active_config().model,
            "claude-sonnet-4-6"
        );
    }
}
