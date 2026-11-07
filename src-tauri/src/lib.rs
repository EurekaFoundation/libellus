//! Libellus desktop: la stessa app web, in una finestra propria e con accesso
//! alla finestra di sistema "Salva con nome" per le esportazioni.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("errore all'avvio di Libellus");
}
