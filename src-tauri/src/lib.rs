mod autocomplete;
mod bridge;
mod commands;
mod config;
mod error;
mod llm;
mod plugins;
mod research;
mod shadow;
mod sidecar;
mod terminal;
mod workspace;

use tauri::Manager;

/// Exposed for criterion benchmarks.
pub fn shadow_prepare_tree_bench(
    workspace: &std::path::Path,
    shadow: &std::path::Path,
) -> Result<(), error::AppError> {
    shadow::prepare::prepare_tree(workspace, shadow)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let workspace_state = workspace::WorkspaceState::new();
    let bridge_state = bridge::BridgeState::new();
    let sidecar_lifecycle = sidecar::SidecarLifecycle::new();
    let sidecar_manager = sidecar::SidecarManager::new();
    let plugin_state = plugins::PluginState::new().expect("plugin host");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(
            llm::bridge::LlmState::new().expect("failed to initialize LLM state"),
        )
        .manage(llm::registry::StreamRegistry::new())
        .manage(workspace_state)
        .manage(terminal::TerminalState::new())
        .manage(shadow::ShadowState::new())
        .manage(std::sync::Mutex::new(bridge_state.clone()))
        .manage(sidecar_lifecycle)
        .manage(sidecar_manager)
        .manage(plugin_state)
        .setup(move |app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(bridge::start_server(handle, bridge_state));

            if !cfg!(debug_assertions) {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.close_devtools();
                }
            }

            if !cfg!(debug_assertions) {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(manager) = app_handle.try_state::<sidecar::SidecarManager>() {
                        let _ = manager.ensure_running(&app_handle).await;
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::file::read_file,
            commands::file::write_file,
            commands::file::open_file_dialog,
            commands::file::save_file_dialog,
            commands::fs_ops::create_dir,
            commands::fs_ops::create_file,
            commands::fs_ops::delete_path,
            commands::fs_ops::rename_path,
            commands::fs_ops::move_path,
            commands::diff::parse_patch,
            commands::diff::apply_patch_hunks,
            commands::diff::reject_patch,
            commands::llm::llm_complete_stream,
            commands::llm::cancel_stream,
            commands::llm::get_providers,
            commands::llm::set_active_provider,
            commands::llm::get_active_provider,
            commands::llm::test_llm_connection,
            commands::llm::sync_aicery_provider_env,
            commands::workspace::open_workspace,
            commands::workspace::close_workspace,
            commands::workspace::list_dir,
            commands::workspace::get_recent_workspaces,
            commands::workspace::open_directory_dialog,
            commands::terminal::terminal_create,
            commands::terminal::terminal_write,
            commands::terminal::terminal_resize,
            commands::terminal::terminal_destroy,
            commands::terminal::get_terminal_context,
            commands::shadow::shadow_prepare,
            commands::shadow::shadow_apply_patch,
            commands::shadow::shadow_run_command,
            commands::shadow::shadow_discard,
            commands::aicery::aicery_sidecar_status,
            commands::aicery::aicery_create_run,
            commands::aicery::aicery_get_run,
            commands::aicery::aicery_resume_run,
            commands::aicery::aicery_stream_run,
            commands::aicery::aicery_cancel_stream,
            commands::aicery::aicery_cancel_run,
            commands::aicery::aicery_route,
            commands::config::load_workflow_config_cmd,
            commands::config::load_team_context_cmd,
            commands::session::load_session_snapshot,
            commands::session::load_session_snapshot_v2,
            commands::session::save_session_snapshot,
            commands::session::save_session_snapshot_v2,
            commands::session::clear_session_snapshot,
            commands::chat_sessions::list_chat_sessions,
            commands::chat_sessions::load_chat_session,
            commands::chat_sessions::save_chat_session,
            commands::chat_sessions::save_workspace_session_index,
            commands::chat_sessions::delete_chat_session,
            commands::chat_sessions::save_run_archive,
            commands::chat_sessions::list_run_archives,
            commands::chat_sessions::load_run_archive,
            commands::chat_sessions::delete_run_archive,
            commands::chat_sessions::clear_workspace_history,
            commands::chat_sessions::get_idepus_data_paths,
            commands::index::index_workspace,
            commands::index::search_codebase,
            commands::index::grep_workspace_cmd,
            commands::index::get_index_status,
            commands::index::build_context,
            commands::index::is_semantic_index_available,
            commands::memory::is_semantic_memory_available,
            commands::memory::list_memories,
            commands::memory::search_memories,
            commands::memory::upsert_memories,
            commands::memory::pin_memory,
            commands::memory::forget_memory,
            commands::memory::index_change,
            commands::memory::search_changes,
            commands::memory::list_recent_changes,
            commands::memory::list_changes_by_run,
            commands::plan::write_plan_file,
            commands::plan::read_plan,
            commands::plan::write_plan,
            commands::plan::update_plan_status,
            commands::plan::list_plans,
            commands::research::get_research_config,
            commands::research::save_research_config_cmd,
            commands::research::save_research_api_key,
            commands::research::delete_research_api_key_cmd,
            commands::research::test_research_connection,
            commands::autocomplete::get_autocomplete_config,
            commands::autocomplete::save_autocomplete_config_cmd,
            commands::autocomplete::autocomplete_suggest,
            commands::autocomplete::ollama_health_check,
            commands::autocomplete::ollama_pull_model,
            sidecar::manager::sidecar_start,
            sidecar::manager::sidecar_stop,
            sidecar::manager::sidecar_status,
            plugins::load_plugins,
            plugins::list_context_sources,
            commands::telemetry::telemetry_log_event,
            bridge::tool_server::get_bridge_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
