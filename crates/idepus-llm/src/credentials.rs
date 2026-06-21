use crate::error::LLMError;

const SERVICE: &str = "idepus";

pub fn store_api_key(provider_id: &str, api_key: &str) -> Result<(), LLMError> {
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return delete_api_key(provider_id);
    }

    keyring::Entry::new(SERVICE, provider_id)
        .map_err(|e| LLMError::Config(e.to_string()))?
        .set_password(trimmed)
        .map_err(|e| LLMError::Config(format!("keyring store failed: {e}")))
}

pub fn get_api_key(provider_id: &str) -> Result<Option<String>, LLMError> {
    match keyring::Entry::new(SERVICE, provider_id) {
        Ok(entry) => match entry.get_password() {
            Ok(key) if !key.trim().is_empty() => Ok(Some(key)),
            Ok(_) => Ok(None),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(LLMError::Config(format!("keyring read failed: {e}"))),
        },
        Err(e) => Err(LLMError::Config(e.to_string())),
    }
}

pub fn delete_api_key(provider_id: &str) -> Result<(), LLMError> {
    match keyring::Entry::new(SERVICE, provider_id) {
        Ok(entry) => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(LLMError::Config(format!("keyring delete failed: {e}"))),
        },
        Err(e) => Err(LLMError::Config(e.to_string())),
    }
}

pub fn has_api_key(provider_id: &str) -> bool {
    get_api_key(provider_id)
        .ok()
        .flatten()
        .is_some_and(|k| !k.trim().is_empty())
}
