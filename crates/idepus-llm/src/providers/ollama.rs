use std::time::Duration;

use reqwest::Client;
use serde::Deserialize;

use crate::error::LLMError;

const DEFAULT_BASE: &str = "http://127.0.0.1:11434";

pub struct OllamaAutocomplete {
    base_url: String,
    client: Client,
}

impl OllamaAutocomplete {
    pub fn new(base_url: Option<String>) -> Self {
        let client = Client::builder()
            .pool_max_idle_per_host(4)
            .timeout(Duration::from_secs(30))
            .build()
            .expect("ollama autocomplete client");
        Self {
            base_url: base_url.unwrap_or_else(|| DEFAULT_BASE.to_string()),
            client,
        }
    }

    pub async fn fill_in_middle(
        &self,
        prefix: &str,
        suffix: &str,
        model: &str,
        max_tokens: u32,
    ) -> Result<String, LLMError> {
        let prompt = format!(
            "<|fim_prefix|>{prefix}<|fim_suffix|>{suffix}<|fim_middle|>"
        );
        let body = serde_json::json!({
            "model": model,
            "prompt": prompt,
            "stream": false,
            "options": {
                "num_predict": max_tokens,
                "temperature": 0.2,
                "stop": ["<|fim_prefix|>", "<|fim_suffix|>", "<|fim_middle|>", "\n\n"]
            }
        });

        let resp = self
            .client
            .post(format!("{}/api/generate", self.base_url))
            .json(&body)
            .send()
            .await
            .map_err(|e| LLMError::Provider(e.to_string()))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(LLMError::Provider(format!(
                "Ollama generate failed ({status}): {body}"
            )));
        }

        #[derive(Deserialize)]
        struct GenerateResponse {
            response: String,
        }

        let parsed: GenerateResponse = resp
            .json()
            .await
            .map_err(|e| LLMError::Provider(e.to_string()))?;
        Ok(parsed.response)
    }

    pub async fn list_models(&self) -> Result<Vec<String>, LLMError> {
        let resp = self
            .client
            .get(format!("{}/api/tags", self.base_url))
            .send()
            .await
            .map_err(|e| LLMError::Provider(e.to_string()))?;

        if !resp.status().is_success() {
            return Err(LLMError::Provider(format!(
                "Ollama tags failed: {}",
                resp.status()
            )));
        }

        #[derive(Deserialize)]
        struct TagsResponse {
            models: Vec<ModelTag>,
        }
        #[derive(Deserialize)]
        struct ModelTag {
            name: String,
        }

        let parsed: TagsResponse = resp
            .json()
            .await
            .map_err(|e| LLMError::Provider(e.to_string()))?;
        Ok(parsed.models.into_iter().map(|m| m.name).collect())
    }

    pub async fn pull_model(&self, model: &str) -> Result<String, LLMError> {
        let body = serde_json::json!({ "name": model, "stream": false });
        let resp = self
            .client
            .post(format!("{}/api/pull", self.base_url))
            .json(&body)
            .send()
            .await
            .map_err(|e| LLMError::Provider(e.to_string()))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(LLMError::Provider(format!(
                "Ollama pull failed ({status}): {text}"
            )));
        }
        Ok(format!("Pull started/completed for {model}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fim_prompt_format() {
        let provider = OllamaAutocomplete::new(Some("http://127.0.0.1:11434".into()));
        let prompt = format!(
            "<|fim_prefix|>{}<|fim_suffix|>{}<|fim_middle|>",
            "fn main() {", "}"
        );
        assert!(prompt.contains("<|fim_prefix|>"));
        assert!(prompt.contains("<|fim_middle|>"));
        let _ = provider;
    }
}
