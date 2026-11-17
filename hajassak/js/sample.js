/** 샘플 현장(가상 데이터) — 실제 현장·업체와 무관 */
export function makeSample(M) {
  const p = M.newProject("샘플 아파트 신축공사"); p.sample = true;
  p.dongs = M.makeDongs({ start: 101, count: 3, floors: 15, lines: 4, basement: 2 });
  const now = new Date().toISOString();
  const V = [["가나타일(샘플)", "김반장", "010-0000-1001", ["타일", "석공사"]], ["다라도장(샘플)", "이소장", "010-0000-1002", ["도장", "도배"]],
    ["마바창호(샘플)", "박과장", "010-0000-1003", ["창호", "코킹"]], ["사아설비(샘플)", "최대리", "010-0000-1004", ["설비"]], ["자차가구(샘플)", "정실장", "010-0000-1005", ["가구", "수장"]]]
    .map(([name, person, ph, trades]) => ({ id: M.uid("v"), name, person, phones: [ph], trades, memo: "샘플 업체", createdAt: now }));
  const vOf = (t) => V.find((v) => v.trades.includes(t))?.id || "";
  const T = [["타일", "바닥타일", "들뜸", "욕실1", "바닥", "욕실 바닥타일 두드림 시 들뜸음"], ["타일", "줄눈", "줄눈불량", "주방", "벽", "주방 벽타일 줄눈 탈락"],
    ["도장", "내부도장", "도장불량", "발코니", "벽", "발코니 벽 도장 얼룩"], ["도배", "벽지", "오염", "침실2", "벽", "벽지 이음부 오염"],
    ["창호", "PL창호", "작동불량", "거실", "창", "거실 창호 잠금장치 뻑뻑함"], ["코킹", "실리콘", "미시공", "욕실2", "기구", "세면대 하부 실리콘 미시공"],
    ["설비", "수전", "누수", "주방", "기구", "주방 수전 하부 누수"], ["가구", "주방가구", "흠집/찍힘", "주방", "가구", "상부장 도어 찍힘"],
    ["수장", "문틀·문짝", "수직수평불량", "침실1", "문", "방문 닫힘 불량(수직 틀어짐)"], ["석공사", "창대석", "파손", "거실", "창", "창대석 모서리 파손"]];
  const ST = ["접수", "접수", "업체전달", "조치중", "조치완료", "확인완료", "재접수", "접수"];
  const defects = []; let k = 0;
  for (const d of p.dongs) for (const ho of ["302", "503", "801", "1004", "1202"]) for (let j = 0; j < 2; j++) {
    const t = T[(k * 3 + j) % T.length]; const st = ST[k % ST.length]; const age = (k * 2) % 20;
    const created = new Date(Date.now() - age * 864e5).toISOString();
    defects.push({ id: M.uid("h"), projectId: p.id, dong: d.name, floor: M.floorOfHo(ho), ho, common: "", room: t[3], part: t[4], trade: t[0], subTrade: t[1], type: t[2],
      category: k % 3 === 0 ? "사전점검" : "시공불량", severity: k % 7 === 0 ? "긴급" : "보통", content: t[5], vendorId: vOf(t[0]),
      due: M.addDays(7 - age, new Date()), status: st, memo: "", createdAt: created, updatedAt: now, origin: "sample", history: [{ at: created, status: st, note: "샘플" }] });
    k++;
  }
  defects.push({ id: M.uid("h"), projectId: p.id, dong: "", floor: "", ho: "", common: "지하주차장", room: "", part: "바닥", trade: "도장", subTrade: "에폭시", type: "균열",
    category: "시공불량", severity: "긴급", content: "B1 주차장 에폭시 바닥 균열", vendorId: vOf("도장"), due: M.addDays(-2), status: "업체전달", memo: "", createdAt: new Date(Date.now() - 9 * 864e5).toISOString(), updatedAt: now, origin: "sample", history: [] });
  return { project: p, vendors: V, defects };
}
