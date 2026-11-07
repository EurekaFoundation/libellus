// Su Windows, nella versione finale, non apre la finestra del terminale.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    libellus_lib::run()
}
