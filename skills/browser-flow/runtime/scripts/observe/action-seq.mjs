/**
 * Create a per-run action sequence tagger. The in-page recorder emits
 * document-local action metadata so the daemon can correlate each action with
 * its later action-diff; this tagger converts that metadata into a run-local
 * monotonic sequence before persistence.
 */
export function createRunActionSeqTagger() {
  let nextActionSeq = 1;
  /** @type {Map<string, number>} */
  const seqByRecorderAction = new Map();

  /**
   * @param {Record<string, any>} payload
   * @param {{ targetId?: string, tabOrdinal?: number }} [meta]
   * @returns {Record<string, any>}
   */
  return function tagActionSeq(payload, meta = {}) {
    if (!isActionEvent(payload) && payload?.type !== "action-diff") {
      return payload;
    }
    const key = recorderActionKey(payload, meta);
    const tagged = { ...payload };
    if (isActionEvent(tagged)) {
      const seq = nextActionSeq;
      nextActionSeq += 1;
      seqByRecorderAction.set(key, seq);
      tagged.actionSeq = seq;
      return tagged;
    }
    const matchedSeq = seqByRecorderAction.get(key);
    if (typeof matchedSeq === "number") {
      tagged.actionSeq = matchedSeq;
      return tagged;
    }
    const seq = nextActionSeq;
    nextActionSeq += 1;
    seqByRecorderAction.set(key, seq);
    tagged.actionSeq = seq;
    tagged.settleStatus = tagged.settleStatus || "interrupted";
    return tagged;
  };
}

/**
 * @param {Record<string, any>} event
 */
function isActionEvent(event) {
  return event?.type === "click" || event?.type === "input" || event?.type === "submit";
}

/**
 * @param {Record<string, any>} event
 * @param {{ targetId?: string, tabOrdinal?: number }} meta
 */
function recorderActionKey(event, meta) {
  const actionType = event?.type === "action-diff" ? event.refType : event?.type;
  const localSeq = typeof event?.actionSeq === "number" ? String(event.actionSeq) : "";
  return [
    meta.targetId || `tab:${meta.tabOrdinal ?? 0}`,
    typeof event?.documentId === "string" ? event.documentId : "",
    actionType || "",
    localSeq,
    typeof event?.actionId === "string" ? event.actionId : ""
  ].join("\u001f");
}
