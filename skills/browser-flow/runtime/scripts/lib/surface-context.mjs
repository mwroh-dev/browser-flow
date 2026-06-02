const WEATHER_MAP_CONTROL_GROUPS = Object.freeze([
  "visual-layer",
  "observation-layer",
  "timeline",
  "point-overlay"
]);

/**
 * @param {unknown} pageKey
 * @returns {boolean}
 */
export function isWeatherMapPageKey(pageKey) {
  return typeof pageKey === "string" && pageKey.startsWith("manual/weather.naver.com/map/");
}

/**
 * @param {Record<string, any> | null | undefined} signals
 * @returns {"visual-layer" | "observation-layer" | "timeline" | "point-overlay" | null}
 */
export function classifyWeatherMapControlGroup(signals) {
  if (!signals || typeof signals !== "object") return null;
  const structuralKey = lower(signals.structuralKey);
  const name = lower(signals.name);
  const neighbors = Array.isArray(signals.neighborTexts)
    ? signals.neighborTexts.map((entry) => lower(entry)).join(" ")
    : "";

  if (
    structuralKey.includes("_playbtn") ||
    name.includes("일시정지") ||
    name.includes("재생")
  ) {
    return "timeline";
  }

  if (
    structuralKey.includes("point_overlay") ||
    structuralKey.includes("button_poi") ||
    name.includes("내위치") ||
    name.includes("poi")
  ) {
    return "point-overlay";
  }

  if (
    structuralKey.includes("map_depth_button") ||
    name.includes("영상") ||
    name.includes("위성") ||
    name.includes("레이더") ||
    name.includes("강수예측") ||
    name.includes("기온") ||
    neighbors.includes("위성") ||
    neighbors.includes("레이더") ||
    neighbors.includes("강수예측")
  ) {
    return "visual-layer";
  }

  if (
    structuralKey.includes("map_item_button") ||
    structuralKey.includes("type_aws") ||
    name.includes("관측") ||
    name.includes("cctv") ||
    neighbors.includes("1h 강수") ||
    neighbors.includes("일 강수량")
  ) {
    return "observation-layer";
  }

  return null;
}

/**
 * @param {Record<string, any>} step
 * @returns {{ kind: "weather-map", surfaceKey: string, controlGroup: "visual-layer" | "observation-layer" | "timeline" | "point-overlay" } | undefined}
 */
export function deriveSurfaceContextForStep(step) {
  if (!step || step.action !== "click" || !isWeatherMapPageKey(step.pageKey)) {
    return undefined;
  }
  const signals = step.locator && typeof step.locator === "object"
    ? step.locator
    : step;
  const controlGroup = classifyWeatherMapControlGroup(signals);
  if (!controlGroup) {
    return undefined;
  }
  return {
    kind: "weather-map",
    surfaceKey: `${step.pageKey}#weather-map`,
    controlGroup
  };
}

/**
 * @returns {readonly string[]}
 */
export function getWeatherMapControlGroups() {
  return WEATHER_MAP_CONTROL_GROUPS;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function lower(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}
