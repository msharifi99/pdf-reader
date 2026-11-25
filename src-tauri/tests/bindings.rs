/// `npm run gen:bindings` runs this; output must be deterministic.
#[test]
fn export_bindings() {
    quire_lib::export_bindings(&quire_lib::specta_builder());
}
