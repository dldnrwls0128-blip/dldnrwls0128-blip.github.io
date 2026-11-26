/** 1.6.0 이름 붙인 목록(모아보기). 이 기기 localStorage만. 팀 동기화·Firestore에 안 넣음. */
const SETS = (pid) => "sets:" + (pid || "");
const MIG = (pid) => "setsMigrated:" + (pid || "");
const FAV = (pid) => "favIds:" + (pid || "");

export const parseIds = (raw) => [...new Set((Array.isArray(raw) ? raw : []).map((x) => String(x || "")).filter(Boolean))];

export function parseSets(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => ({
    id: String(s?.id || ""),
    name: String(s?.name || "").trim(),
    ids: parseIds(s?.ids),
    createdAt: s?.createdAt || "",
  })).filter((s) => s.id && s.name);
}

export const uid = () => "ls" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** 1.5.2 ⭐ id가 있을 때만 ‘모아보기’ 목록 1개를 만든다. 원본 favIds는 지우지 않음. 한 번만 실행. */
export function migrateFavs(LS, pid) {
  const mig = { ...(LS.get(MIG(pid), {}) || {}) };
  let sets = parseSets(LS.get(SETS(pid), []));
  if (!mig.fav) {
    const ids = parseIds(LS.get(FAV(pid), []));
    if (ids.length && !sets.some((s) => s.id === "migrated-fav")) {
      sets = [{ id: "migrated-fav", name: "모아보기", ids, createdAt: new Date().toISOString() }, ...sets];
      LS.set(SETS(pid), sets);
    }
    mig.fav = true;
    LS.set(MIG(pid), mig);
  }
  return sets;
}

export const loadSets = (LS, pid) => migrateFavs(LS, pid);
export const saveSets = (LS, pid, sets) => { const next = parseSets(sets); LS.set(SETS(pid), next); return next; };

export function addSet(sets, name, ids = []) {
  const nm = String(name || "").trim();
  if (!nm) return { sets, error: "이름을 입력하세요" };
  if (nm.length > 20) return { sets, error: "20자 이내로 입력하세요" };
  if (sets.some((s) => s.name === nm)) return { sets, error: "같은 이름의 목록이 있어요" };
  const s = { id: uid(), name: nm, ids: parseIds(ids), createdAt: new Date().toISOString() };
  return { sets: [...sets, s], set: s };
}

export function renameSet(sets, id, name) {
  const nm = String(name || "").trim();
  if (!nm) return { sets, error: "이름을 입력하세요" };
  if (nm.length > 20) return { sets, error: "20자 이내로 입력하세요" };
  if (sets.some((s) => s.id !== id && s.name === nm)) return { sets, error: "같은 이름의 목록이 있어요" };
  return { sets: sets.map((s) => (s.id === id ? { ...s, name: nm } : s)) };
}

export function deleteSet(sets, id) {
  return { sets: sets.filter((s) => s.id !== id) };
}

/** dir: -1 위로, +1 아래로. 끝이면 그대로. */
export function moveSet(sets, id, dir) {
  const i = sets.findIndex((s) => s.id === id);
  const j = i + (Number(dir) < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= sets.length) return { sets };
  const next = sets.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return { sets: next };
}

export const setById = (sets, id) => sets.find((s) => s.id === id) || null;
export const inSet = (set, id) => !!(set && set.ids.includes(id));

export function toggleIds(sets, setId, ids, on) {
  const add = parseIds(ids);
  return {
    sets: sets.map((s) => {
      if (s.id !== setId) return s;
      const cur = new Set(s.ids);
      for (const id of add) {
        if (on === true) cur.add(id);
        else if (on === false) cur.delete(id);
        else if (cur.has(id)) cur.delete(id); else cur.add(id);
      }
      return { ...s, ids: [...cur] };
    }),
  };
}

export function countsOf(set, defects, isOpen) {
  const s = new Set(set?.ids || []);
  const items = (defects || []).filter((d) => s.has(d.id));
  const open = items.filter(isOpen).length;
  return { all: items.length, open, done: items.length - open, items };
}

export const itemsOf = (set, defects) => {
  const s = new Set(set?.ids || []);
  return (defects || []).filter((d) => s.has(d.id));
};
