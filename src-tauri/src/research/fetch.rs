use reqwest::blocking::Client;
use reqwest::redirect::Policy;
use serde_json::{json, Value};

use crate::error::AppError;

use super::config::load_research_config;

const MAX_BODY_BYTES: usize = 500_000;
const FETCH_TIMEOUT_SECS: u64 = 15;
const MAX_REDIRECTS: usize = 5;

pub fn fetch_url(url: &str) -> Result<Value, AppError> {
    let config = load_research_config()?;
    if !config.enabled {
        return Err(AppError::Workspace("web_research_disabled".into()));
    }

    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(AppError::Workspace("fetch_url: invalid URL scheme".into()));
    }

    if let Some(host) = url_host(url) {
        if domain_blocked(&host, &config.blocked_domains) {
            return Err(AppError::Workspace(format!("domain blocked: {host}")));
        }
        if !config.allowed_domains.is_empty()
            && !domain_allowed(&host, &config.allowed_domains)
        {
            return Err(AppError::Workspace(format!("domain not allowed: {host}")));
        }
    }

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(FETCH_TIMEOUT_SECS))
        .redirect(Policy::limited(MAX_REDIRECTS))
        .build()
        .map_err(|e| AppError::Config(e.to_string()))?;

    let response = client
        .get(url)
        .header("User-Agent", "idepus-research/1.0")
        .send()
        .map_err(|e| AppError::Workspace(format!("fetch failed: {e}")))?;

    if !response.status().is_success() {
        return Err(AppError::Workspace(format!(
            "fetch HTTP {}",
            response.status()
        )));
    }

    let bytes = response
        .bytes()
        .map_err(|e| AppError::Workspace(e.to_string()))?;
    let truncated = bytes.len() > MAX_BODY_BYTES;
    let slice = if truncated {
        &bytes[..MAX_BODY_BYTES]
    } else {
        &bytes
    };

    let html = String::from_utf8_lossy(slice);
    let text = html_to_text(&html);
    let summary = text.chars().take(8000).collect::<String>();

    Ok(json!({
        "url": url,
        "title": extract_title(&html),
        "summary": summary,
        "truncated": truncated,
    }))
}

fn html_to_text(html: &str) -> String {
    html2text::from_read(html.as_bytes(), 120)
        .unwrap_or_else(|_| strip_tags_fallback(html))
}

fn strip_tags_fallback(html: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn extract_title(html: &str) -> String {
    let lower = html.to_lowercase();
    if let Some(start) = lower.find("<title>") {
        let rest = &html[start + 7..];
        if let Some(end) = rest.to_lowercase().find("</title>") {
            return rest[..end].trim().to_string();
        }
    }
    String::new()
}

fn url_host(url: &str) -> Option<String> {
    let without_scheme = url.split("://").nth(1)?;
    let host = without_scheme.split('/').next()?;
    Some(host.split(':').next()?.to_lowercase())
}

fn domain_blocked(host: &str, blocked: &[String]) -> bool {
    blocked.iter().any(|d| host == d || host.ends_with(&format!(".{d}")))
}

fn domain_allowed(host: &str, allowed: &[String]) -> bool {
    allowed.iter().any(|d| host == d || host.ends_with(&format!(".{d}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_tags_basic() {
        let text = strip_tags_fallback("<p>Hello <b>world</b></p>");
        assert!(text.contains("Hello"));
        assert!(text.contains("world"));
    }
}
