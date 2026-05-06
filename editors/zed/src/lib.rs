use zed_extension_api::{self as zed, settings::LspSettings, LanguageServerId, Result};

struct DsLanguageServerExtension;

impl zed::Extension for DsLanguageServerExtension {
    fn new() -> Self {
        DsLanguageServerExtension
    }

    fn language_server_command(
        &mut self,
        language_server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        let settings = LspSettings::for_worktree(language_server_id.as_ref(), worktree)
            .map_err(|e| format!("Failed to get settings: {e}"))?;

        // Get server path from settings, or use default
        let server_path = settings
            .settings
            .as_ref()
            .and_then(|s| s.get("serverPath"))
            .and_then(|v| v.as_str())
            .unwrap_or("ds-language-server")
            .to_string();

        // Get node binary path from settings
        let node_path = settings
            .settings
            .as_ref()
            .and_then(|s| s.get("nodePath"))
            .and_then(|v| v.as_str())
            .unwrap_or("node")
            .to_string();

        // If server path ends with .js or .mjs, run with node
        if server_path.ends_with(".js") || server_path.ends_with(".mjs") {
            Ok(zed::Command {
                command: node_path,
                args: vec![server_path, "--stdio".to_string()],
                env: Default::default(),
            })
        } else {
            // Assume it's a binary
            Ok(zed::Command {
                command: server_path,
                args: vec!["--stdio".to_string()],
                env: Default::default(),
            })
        }
    }
}

zed::register_extension!(DsLanguageServerExtension);
