import { isIrreversibleText } from "./safety-classify.mjs";

// create/update keywords beyond the irreversible set (delete/pay/send already covered there).
const CUD_PATTERN = /(추가|\badd\b|create|생성|새 |\bnew\b|저장|save|수정|\bedit\b|update|등록|register|업로드|upload|작성|\bpost\b|댓글|comment|좋아요|\blike\b|rename|이름.?바꾸기|\bsend\b)/i;
// explicit, confident read-only navigation terms (for buttons; links are always navigable).
const SAFE_NAV_PATTERN = /(보기|view|open|열기|상세|detail|다음|\bnext\b|더보기|more|이전|\bprev\b|tab|탭|filter|필터|catalog|목록|list|home|홈|back to)/i;

/**
 * Conservative read-only-navigation classifier.
 *   cud      = irreversible/CUD keyword → recorded, NEVER clicked
 *   navigate = role=link, OR a button whose name is an explicit nav term → clicked
 *   skip     = everything else (ambiguous buttons, inputs) → not clicked
 * @param {{ role?: string, name?: string }} aff
 * @returns {"navigate" | "cud" | "skip"}
 */
export function classifyAffordance(aff) {
  const name = String((aff && aff.name) || "");
  const role = String((aff && aff.role) || "");
  if (isIrreversibleText(name) || CUD_PATTERN.test(name)) return "cud"; // cud wins over nav
  if (role === "link") return "navigate";
  if (role === "button" && SAFE_NAV_PATTERN.test(name)) return "navigate";
  return "skip";
}
