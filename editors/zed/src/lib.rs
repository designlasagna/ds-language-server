use std::{env, fs};
use zed_extension_api::{self as zed, serde_json, settings::LspSettings, LanguageServerId, Result};

/// The npm package that contains the DSLS language server.
const SERVER_PACKAGE: &str = "@designlasagna/ds-language-server";
/// Entry point of the server inside the installed package. Relative to the
/// extension's working directory (where Zed installs npm packages).
const SERVER_ENTRY: &str = "node_modules/@designlasagna/ds-language-server/dist/server.js";

struct DsLanguageServerExtension {
    cached_server_path: Option<String>,
}

impl DsLanguageServerExtension {
    fn server_exists() -> bool {
        fs::metadata(SERVER_ENTRY).is_ok_and(|stat| stat.is_file())
    }

    /// Resolves the absolute path of the server entry point, installing the
    /// published npm package into this extension's working directory first
    /// if needed.
    ///
    /// Version policy: track the latest published version by default (the
    /// same pattern Zed's own HTML extension uses). A `serverVersion`
    /// language-server setting pins an exact version instead.
    fn server_entry_path(
        &mut self,
        language_server_id: &LanguageServerId,
        pinned_version: Option<&str>,
    ) -> Result<String> {
        if let Some(path) = &self.cached_server_path {
            if Self::server_exists() {
                return Ok(path.clone());
            }
        }

        let installed_version = zed::npm_package_installed_version(SERVER_PACKAGE)
            .ok()
            .flatten();

        let wanted_version = match pinned_version {
            Some(version) => Some(version.to_string()),
            None => zed::npm_package_latest_version(SERVER_PACKAGE).ok(),
        };

        match wanted_version {
            None => {
                let message = format!(
                    "no published version of '{SERVER_PACKAGE}' on npm yet; \
                     auto-install becomes available once the package is released"
                );
                zed::set_language_server_installation_status(
                    language_server_id,
                    &zed::LanguageServerInstallationStatus::Failed(message.clone()),
                );
                Err(message)?
            }
            Some(version) => {
                if !Self::server_exists() || installed_version.as_deref() != Some(version.as_str())
                {
                    zed::set_language_server_installation_status(
                        language_server_id,
                        &if Self::server_exists() {
                            zed::LanguageServerInstallationStatus::CheckingForUpdate
                        } else {
                            zed::LanguageServerInstallationStatus::Downloading
                        },
                    );
                    let result = zed::npm_install_package(SERVER_PACKAGE, &version);
                    if let Err(error) = result {
                        // Tolerate the failure only if a usable, matching
                        // installation is already present.
                        let usable = Self::server_exists()
                            && installed_version.as_deref() == Some(version.as_str());
                        if !usable {
                            zed::set_language_server_installation_status(
                                language_server_id,
                                &zed::LanguageServerInstallationStatus::Failed(error.clone()),
                            );
                            Err(error)?
                        }
                    }
                    if !Self::server_exists() {
                        let message = format!(
                            "installed package '{SERVER_PACKAGE}' did not contain expected path '{SERVER_ENTRY}'"
                        );
                        zed::set_language_server_installation_status(
                            language_server_id,
                            &zed::LanguageServerInstallationStatus::Failed(message.clone()),
                        );
                        Err(message)?
                    }
                }
            }
        }

        let path = env::current_dir()
            .unwrap()
            .join(SERVER_ENTRY)
            .to_string_lossy()
            .to_string();
        self.cached_server_path = Some(path.clone());
        Ok(path)
    }
}

impl zed::Extension for DsLanguageServerExtension {
    fn new() -> Self {
        DsLanguageServerExtension {
            cached_server_path: None,
        }
    }

    fn language_server_command(
        &mut self,
        language_server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        let settings = LspSettings::for_worktree(language_server_id.as_ref(), worktree)
            .map_err(|e| format!("Failed to get settings: {e}"))?;

        let settings = settings.settings.unwrap_or_default();

        // Automatic distribution: install the published package into the
        // extension's working directory and run it with the Node runtime
        // bundled with Zed (no user-installed Node required).
        let pinned_version = settings
            .get("serverVersion")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let server_path = self.server_entry_path(language_server_id, pinned_version.as_deref())?;
        let node_path =
            zed::node_binary_path().map_err(|e| format!("Failed to get Node binary path: {e}"))?;

        Ok(zed::Command {
            command: node_path,
            args: vec![server_path, "--stdio".to_string()],
            env: Default::default(),
        })
    }

    fn language_server_initialization_options(
        &mut self,
        language_server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<Option<serde_json::Value>> {
        let settings = LspSettings::for_worktree(language_server_id.as_ref(), worktree)
            .map_err(|e| format!("Failed to get settings: {e}"))?;

        // Forward the user's `settings` block as initialize options.
        Ok(settings.settings)
    }

    fn language_server_workspace_configuration(
        &mut self,
        language_server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<Option<serde_json::Value>> {
        let settings = LspSettings::for_worktree(language_server_id.as_ref(), worktree)
            .map_err(|e| format!("Failed to get settings: {e}"))?;

        // The server requests the `dsLanguageServer` configuration section.
        Ok(Some(serde_json::json!({
            "dsLanguageServer": settings.settings.unwrap_or_default(),
        })))
    }
}

zed::register_extension!(DsLanguageServerExtension);
