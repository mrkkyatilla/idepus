/** Mirrors idepus-plugin/agents/graph.py::_is_analysis_task */
export function isAnalysisTask(text: string): boolean {
  const lower = text.toLowerCase();
  const analysisMarkers = [
    "analiz",
    "analyze",
    "analyse",
    "explain",
    "what does",
    "what is",
    "ne işe yarı",
    "ne işe",
    "ne yapıyor",
    "ne durumda",
    "describe",
    "incele",
    "tell me",
    "summarize",
    "summary",
    "özet",
    "açıkla",
    "how does",
    "nasıl çalış",
    "söyle",
    "bul ve",
    "find and",
    "find the",
    "locate",
  ];
  const editMarkers = [
    "fix",
    "patch",
    "edit",
    "change",
    "add ",
    "remove",
    "delete",
    "create",
    "implement",
    "refactor",
    "update",
    "write",
    "düzelt",
    "ekle",
    "oluştur",
    "değiştir",
    "yaz",
    "kaldır",
    "apply",
  ];
  if (!analysisMarkers.some((marker) => lower.includes(marker))) {
    return false;
  }
  return !editMarkers.some((marker) => lower.includes(marker));
}
