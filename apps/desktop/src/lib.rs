pub mod connectivity;

use thiserror::Error;
use url::Url;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NavigationDecision {
    Internal,
    External,
    LocalToolbox,
    Blocked,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ConfigError {
    #[error("workspace URL is invalid")]
    InvalidUrl,
    #[error("workspace URL must use HTTPS")]
    InsecureScheme,
    #[error("workspace URL must include a host")]
    MissingHost,
}

#[derive(Debug, Clone)]
pub struct DesktopConfig {
    workspace_url: Url,
}

impl DesktopConfig {
    pub fn from_workspace_url(value: &str) -> Result<Self, ConfigError> {
        let workspace_url = Url::parse(value).map_err(|_| ConfigError::InvalidUrl)?;
        if workspace_url.scheme() != "https" {
            return Err(ConfigError::InsecureScheme);
        }
        if workspace_url.host_str().is_none() {
            return Err(ConfigError::MissingHost);
        }

        Ok(Self { workspace_url })
    }

    pub fn workspace_url(&self) -> &Url {
        &self.workspace_url
    }

    pub fn health_url(&self) -> Url {
        self.workspace_url
            .join("/api/health")
            .expect("an absolute HTTPS URL can join a fixed health path")
    }

    pub fn classify_navigation(&self, target: &Url) -> NavigationDecision {
        if target.scheme() != "https" {
            return NavigationDecision::Blocked;
        }

        if target.origin() == self.workspace_url.origin() {
            NavigationDecision::Internal
        } else {
            NavigationDecision::External
        }
    }

    pub fn classify_navigation_with_toolbox(
        &self,
        target: &Url,
        toolbox_origin: &Url,
    ) -> NavigationDecision {
        if toolbox_origin.scheme() == "http"
            && toolbox_origin.host_str() == Some("127.0.0.1")
            && target.origin() == toolbox_origin.origin()
        {
            NavigationDecision::LocalToolbox
        } else {
            self.classify_navigation(target)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{ConfigError, DesktopConfig, NavigationDecision};
    use url::Url;

    #[test]
    fn rejects_insecure_release_workspace_url() {
        let error = DesktopConfig::from_workspace_url("http://ai.mislw.cn")
            .expect_err("release workspace URL must be HTTPS");

        assert_eq!(error, ConfigError::InsecureScheme);
    }

    #[test]
    fn builds_health_url_at_the_workspace_origin() {
        let config = DesktopConfig::from_workspace_url("https://ai.mislw.cn/workspace")
            .expect("valid workspace URL");

        assert_eq!(
            config.health_url().as_str(),
            "https://ai.mislw.cn/api/health"
        );
    }

    #[test]
    fn keeps_same_origin_navigation_inside_the_app() {
        let config =
            DesktopConfig::from_workspace_url("https://ai.mislw.cn").expect("valid workspace URL");
        let target = Url::parse("https://ai.mislw.cn/notes/123").expect("valid target URL");

        assert_eq!(
            config.classify_navigation(&target),
            NavigationDecision::Internal
        );
    }

    #[test]
    fn sends_other_https_origins_to_the_system_browser() {
        let config =
            DesktopConfig::from_workspace_url("https://ai.mislw.cn").expect("valid workspace URL");
        let target = Url::parse("https://docs.qq.com/doc/example").expect("valid target URL");

        assert_eq!(
            config.classify_navigation(&target),
            NavigationDecision::External
        );
    }

    #[test]
    fn blocks_non_web_navigation_schemes() {
        let config =
            DesktopConfig::from_workspace_url("https://ai.mislw.cn").expect("valid workspace URL");
        let target = Url::parse("file:///C:/Windows/System32/calc.exe").expect("valid target URL");

        assert_eq!(
            config.classify_navigation(&target),
            NavigationDecision::Blocked
        );
    }

    #[test]
    fn recognizes_only_the_exact_desktop_toolbox_origin() {
        let config =
            DesktopConfig::from_workspace_url("https://ai.mislw.cn").expect("valid workspace URL");
        let toolbox = Url::parse("http://127.0.0.1:49152/").expect("valid toolbox URL");
        let target = Url::parse("http://127.0.0.1:49152/app.js").expect("valid target URL");

        assert_eq!(
            config.classify_navigation_with_toolbox(&target, &toolbox),
            NavigationDecision::LocalToolbox
        );
    }

    #[test]
    fn blocks_other_loopback_ports() {
        let config =
            DesktopConfig::from_workspace_url("https://ai.mislw.cn").expect("valid workspace URL");
        let toolbox = Url::parse("http://127.0.0.1:49152/").expect("valid toolbox URL");
        let target = Url::parse("http://127.0.0.1:37654/").expect("valid target URL");

        assert_eq!(
            config.classify_navigation_with_toolbox(&target, &toolbox),
            NavigationDecision::Blocked
        );
    }
}
