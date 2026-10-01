// Exporta a .xlsx con SheetJS; si no carga, descarga CSV compatible con Excel.
export function exportExcel(recs) {
  const rows = [["N°", "Placa", "Fecha", "Hora"], ...recs.map((r, i) => [i + 1, r.placa, r.fecha, r.hora])];
  const d = new Date(), iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (window.XLSX) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 6 }, { wch: 12 }, { wch: 12 }, { wch: 8 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Placas");
    XLSX.writeFile(wb, `registro_placas_${iso}.xlsx`);
    return;
  }
  const csv = "\ufeff" + rows.map(r => r.join(";")).join("\r\n");
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })), download: `registro_placas_${iso}.csv`
  });
  a.click(); URL.revokeObjectURL(a.href);
}
