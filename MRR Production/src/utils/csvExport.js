export const downloadCSV = (filename, rows, headers) => {
  const lines = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => `"${r[h] ?? ""}"`).join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
};
