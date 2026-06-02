// @ts-check
// In-page locator capture source — pure string that can be eval'd in-page.
// Mirrors scripts/lib/structural-fp.mjs and scripts/lib/rel-xpath.mjs byte-for-byte
// in terms of output for identical inputs.
//
// CRITICAL: the string content must NOT contain backticks or ${ sequences because
// it will be embedded inside another String.raw template in the recorder.

export const locatorCaptureSource = (
  'var __bfDYNAMIC_RE = /(^|[-_])(is|has|js)[-_]|^(css|sc|jsx)-|[0-9a-f]{6,}$|[a-z0-9]{8,}$/;' +
  '\n' +
  'function __bfFilterDynamicClasses(classes) {' +
  '\n  if (!Array.isArray(classes)) return [];' +
  '\n  return classes.filter(function(c) { return typeof c === "string" && c.length > 0 && !__bfDYNAMIC_RE.test(c); });' +
  '\n}' +
  '\n' +
  'function __bfCanonical(d, keepAllClasses) {' +
  '\n  var tagPath = (Array.isArray(d.tagPath) ? d.tagPath : []).join(">");' +
  '\n  var staticAttrs = d.staticAttrs != null ? d.staticAttrs : {};' +
  '\n  var attrEntries = [];' +
  '\n  for (var k in staticAttrs) {' +
  '\n    if (Object.prototype.hasOwnProperty.call(staticAttrs, k)) {' +
  '\n      var v = staticAttrs[k];' +
  '\n      if (v != null && v !== "") attrEntries.push([k, v]);' +
  '\n    }' +
  '\n  }' +
  '\n  attrEntries.sort(function(a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });' +
  '\n  var attrs = attrEntries.map(function(pair) { return pair[0] + "=" + pair[1]; }).join(",");' +
  '\n  var rawClasses = Array.isArray(d.classes) ? d.classes : [];' +
  '\n  var filteredClasses = keepAllClasses ? rawClasses : __bfFilterDynamicClasses(rawClasses);' +
  '\n  var classes = filteredClasses.slice().sort().join(".");' +
  '\n  var name = d.name != null ? String(d.name).trim() : "";' +
  '\n  var tag = d.tag != null ? d.tag : "";' +
  '\n  return tagPath + "|" + tag + "|" + attrs + "|" + classes + "|" + name;' +
  '\n}' +
  '\n' +
  'function __bfBuildStructuralKey(d) { return __bfCanonical(d, false); }' +
  '\n' +
  'function __bfBuildElementKey(d) { return __bfCanonical(d, true); }' +
  '\n' +
  'function __bfBuildRelXPath(chain) {' +
  '\n  if (!Array.isArray(chain) || chain.length === 0) return "";' +
  '\n  function anchorStep(entry) {' +
  '\n    if (entry.id) return "//*[@id=\'" + entry.id + "\']";' +
  '\n    if (entry.dataBf) return "//*[@data-bf=\'" + entry.dataBf + "\']";' +
  '\n    if (entry.dataTestid) return "//*[@data-testid=\'" + entry.dataTestid + "\']";' +
  '\n    return null;' +
  '\n  }' +
  '\n  function positionalStep(entry) {' +
  '\n    var tag = entry.tag;' +
  '\n    var siblings = entry.sameTagSiblings != null ? entry.sameTagSiblings : 1;' +
  '\n    if (siblings > 1) {' +
  '\n      return tag + "[" + (entry.indexAmongTag != null ? entry.indexAmongTag : 1) + "]";' +
  '\n    }' +
  '\n    return tag;' +
  '\n  }' +
  '\n  var anchorIdx = -1;' +
  '\n  for (var i = chain.length - 1; i >= 0; i--) {' +
  '\n    if (anchorStep(chain[i]) !== null) { anchorIdx = i; break; }' +
  '\n  }' +
  '\n  if (anchorIdx !== -1) {' +
  '\n    var parts = [anchorStep(chain[anchorIdx])];' +
  '\n    for (var j = anchorIdx + 1; j < chain.length; j++) {' +
  '\n      parts.push(positionalStep(chain[j]));' +
  '\n    }' +
  '\n    return parts.join("/");' +
  '\n  }' +
  '\n  return "//" + chain.map(positionalStep).join("/");' +
  '\n}' +
  '\n' +
  'function __bfComputedName(el) {' +
  '\n  var ariaLabel = el.getAttribute("aria-label");' +
  '\n  if (ariaLabel && ariaLabel.trim()) {' +
  '\n    return ariaLabel.replace(/\\s+/g, " ").trim().slice(0, 80);' +
  '\n  }' +
  '\n  var labelledby = el.getAttribute("aria-labelledby");' +
  '\n  if (labelledby && labelledby.trim()) {' +
  '\n    var ids = labelledby.trim().split(/\\s+/);' +
  '\n    var parts = [];' +
  '\n    for (var i = 0; i < ids.length; i++) {' +
  '\n      var ref = document.getElementById(ids[i]);' +
  '\n      if (ref) parts.push((ref.textContent || "").trim());' +
  '\n    }' +
  '\n    var joined = parts.join(" ").replace(/\\s+/g, " ").trim();' +
  '\n    if (joined) return joined.slice(0, 80);' +
  '\n  }' +
  '\n  if (el.id) {' +
  '\n    var forLabel = document.querySelector("label[for=\\"" + el.id + "\\"]");' +
  '\n    if (forLabel) {' +
  '\n      var t = (forLabel.textContent || "").replace(/\\s+/g, " ").trim();' +
  '\n      if (t) return t.slice(0, 80);' +
  '\n    }' +
  '\n  }' +
  '\n  var wrappingLabel = el.closest("label");' +
  '\n  if (wrappingLabel) {' +
  '\n    var wt = (wrappingLabel.textContent || "").replace(/\\s+/g, " ").trim();' +
  '\n    if (wt) return wt.slice(0, 80);' +
  '\n  }' +
  '\n  var placeholder = el.getAttribute("placeholder");' +
  '\n  if (placeholder && placeholder.trim()) {' +
  '\n    return placeholder.replace(/\\s+/g, " ").trim().slice(0, 80);' +
  '\n  }' +
  '\n  var title = el.getAttribute("title");' +
  '\n  if (title && title.trim()) {' +
  '\n    return title.replace(/\\s+/g, " ").trim().slice(0, 80);' +
  '\n  }' +
  // for an editable element the innerText is the USER CONTENT (a typo, a
  // mid-edit, or per-note text) — never identity. Suppress the innerText
  // fallback so editables with no stable accessible name become nameless
  // -> signal-poor -> scope-agent anchors them by boundary.
  '\n  if (el.isContentEditable) { return ""; }' +
  '\n  var innerText = (el.innerText || "").replace(/\\s+/g, " ").trim();' +
  '\n  return innerText.slice(0, 80);' +
  '\n}' +
  '\n' +
  'function __bfCleanText(value, limit) {' +
  '\n  return String(value || "").replace(/\\s+/g, " ").trim().slice(0, limit || 80);' +
  '\n}' +
  '\n' +
  'function __bfDirectTextParts(el) {' +
  '\n  var parts = [];' +
  '\n  function add(value) {' +
  '\n    var text = __bfCleanText(value, 80);' +
  '\n    if (text) parts.push(text);' +
  '\n  }' +
  '\n  function visibleElementParts(child) {' +
  '\n    var childParts = [];' +
  '\n    if (!child || !child.childNodes) return childParts;' +
  '\n    for (var j = 0; j < child.childNodes.length; j++) {' +
  '\n      var nested = child.childNodes[j];' +
  '\n      if (nested.nodeType === 3) {' +
  '\n        var text = __bfCleanText(nested.nodeValue, 80);' +
  '\n        if (text) childParts.push(text);' +
  '\n      } else if (nested.nodeType === 1) {' +
  '\n        var nestedEl = nested;' +
  '\n        try {' +
  '\n          var nestedStyle = window.getComputedStyle(nestedEl);' +
  '\n          if (nestedStyle.display === "none" || nestedStyle.visibility === "hidden" || nestedStyle.visibility === "collapse") continue;' +
  '\n        } catch (_nestedE) { /* best-effort visibility only */ }' +
  '\n        var nestedText = __bfCleanText(nestedEl.innerText || nestedEl.textContent, 80);' +
  '\n        if (nestedText) childParts.push(nestedText);' +
  '\n      }' +
  '\n    }' +
  '\n    return childParts;' +
  '\n  }' +
  '\n  if (!el || !el.childNodes) return parts;' +
  '\n  for (var i = 0; i < el.childNodes.length; i++) {' +
  '\n    var node = el.childNodes[i];' +
  '\n    if (node.nodeType === 3) {' +
  '\n      add(node.nodeValue);' +
  '\n    } else if (node.nodeType === 1) {' +
  '\n      var child = node;' +
  '\n      try {' +
  '\n        var style = window.getComputedStyle(child);' +
  '\n        if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") continue;' +
  '\n      } catch (_e) { /* best-effort visibility only */ }' +
  '\n      var childParts = visibleElementParts(child);' +
  '\n      if (childParts.length > 1) {' +
  '\n        for (var k = 0; k < childParts.length; k++) add(childParts[k]);' +
  '\n      } else {' +
  '\n        add(child.innerText || child.textContent);' +
  '\n      }' +
  '\n    }' +
  '\n  }' +
  '\n  return parts;' +
  '\n}' +
  '\n' +
  'function __bfDedupeAdjacent(parts) {' +
  '\n  var out = [];' +
  '\n  for (var i = 0; i < (Array.isArray(parts) ? parts : []).length; i++) {' +
  '\n    var text = __bfCleanText(parts[i], 80);' +
  '\n    if (!text) continue;' +
  '\n    if (out.length > 0 && out[out.length - 1] === text) continue;' +
  '\n    out.push(text);' +
  '\n  }' +
  '\n  return out;' +
  '\n}' +
  '\n' +
  'function __bfStableIdentityClasses(classes) {' +
  '\n  return __bfFilterDynamicClasses(classes).filter(function(c) {' +
  '\n    return !/^(is|has|selected|active|checked|current|on|type)[-_]/i.test(c) &&' +
  '\n      !/^(selected|active|checked|current|on)$/i.test(c);' +
  '\n  });' +
  '\n}' +
  '\n' +
  'function __bfObservedElement(el) {' +
  '\n  var rect = el && el.getBoundingClientRect ? el.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };' +
  '\n  var classList = el ? Array.prototype.slice.call(el.classList || []) : [];' +
  '\n  return {' +
  '\n    tag: el ? el.tagName.toLowerCase() : "",' +
  '\n    role: el ? (el.getAttribute("role") || __bfImplicitRole(el)) : "",' +
  '\n    type: el ? (el.getAttribute("type") || "") : "",' +
  '\n    classList: classList,' +
  '\n    fullText: el ? __bfCleanText(el.innerText || el.textContent, 120) : "",' +
  '\n    computedName: el ? __bfComputedName(el) : "",' +
  '\n    textParts: __bfDirectTextParts(el),' +
  '\n    ariaSelected: el ? (el.getAttribute("aria-selected") || "") : "",' +
  '\n    ariaPressed: el ? (el.getAttribute("aria-pressed") || "") : "",' +
  '\n    ariaCurrent: el ? (el.getAttribute("aria-current") || "") : "",' +
  '\n    box: { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2, w: rect.width, h: rect.height }' +
  '\n  };' +
  '\n}' +
  '\n' +
  'function __bfIdentityShapeFromDescriptor(d) {' +
  '\n  var copy = {' +
  '\n    tagPath: Array.isArray(d.tagPath) ? d.tagPath : [],' +
  '\n    tag: d.tag || "",' +
  '\n    staticAttrs: d.staticAttrs || {},' +
  '\n    classes: __bfStableIdentityClasses(Array.isArray(d.classes) ? d.classes : []),' +
  '\n    name: ""' +
  '\n  };' +
  '\n  return __bfCanonical(copy, true);' +
  '\n}' +
  '\n' +
  'function __bfControlKind(el, observed) {' +
  '\n  var role = observed && observed.role ? observed.role : (el ? (el.getAttribute("role") || __bfImplicitRole(el)) : "");' +
  '\n  var tag = observed && observed.tag ? observed.tag : (el ? el.tagName.toLowerCase() : "");' +
  '\n  var parts = observed && Array.isArray(observed.textParts) ? observed.textParts : [];' +
  '\n  if ((role === "button" || tag === "button" || role === "tab" || role === "switch") && parts.length > 1) {' +
  '\n    return "carrier";' +
  '\n  }' +
  '\n  if (role || tag === "button" || tag === "a" || tag === "input" || tag === "select" || tag === "textarea" || tag === "summary") {' +
  '\n    return "option";' +
  '\n  }' +
  '\n  return "";' +
  '\n}' +
  '\n' +
  'function __bfReplayIdentity(el) {' +
  '\n  var observed = __bfObservedElement(el);' +
  '\n  var descriptor = __bfDescriptorFromElement(el);' +
  '\n  var textParts = observed.textParts.length ? observed.textParts : (observed.computedName ? [observed.computedName] : []);' +
  '\n  var name = textParts.length > 1 ? textParts.join(" ") : (observed.computedName || textParts.join(" "));' +
  '\n  var identityShape = __bfIdentityShapeFromDescriptor(descriptor);' +
  '\n  var controlKind = __bfControlKind(el, observed);' +
  '\n  return {' +
  '\n    name: name,' +
  '\n    identityKey: identityShape + controlKind,' +
  '\n    identityShape: identityShape,' +
  '\n    controlKind: controlKind,' +
  '\n    textParts: textParts' +
  '\n  };' +
  '\n}' +
  '\n' +
  'function __bfSkeletonEntry(el) {' +
  '\n  var descriptor = __bfDescriptorFromElement(el);' +
  '\n  var replay = __bfReplayIdentity(el);' +
  '\n  var parts = __bfDedupeAdjacent(replay.textParts);' +
  '\n  var name = parts.length ? parts.join(" ") : replay.name;' +
  '\n  return {' +
  '\n    role: el.getAttribute("role") || __bfImplicitRole(el),' +
  '\n    name: name,' +
  '\n    structuralKey: __bfBuildStructuralKey(descriptor),' +
  '\n    controlKind: replay.controlKind' +
  '\n  };' +
  '\n}' +
  '\n' +
  'function __bfDescriptorFromElement(el) {' +
  '\n  var tagPath = [];' +
  '\n  var cursor = el.parentElement;' +
  '\n  var depth = 0;' +
  '\n  while (cursor && depth < 5 && cursor !== document.documentElement) {' +
  '\n    tagPath.unshift(cursor.tagName.toLowerCase());' +
  '\n    cursor = cursor.parentElement;' +
  '\n    depth++;' +
  '\n  }' +
  '\n  var staticAttrs = {};' +
  '\n  var role = el.getAttribute("role");' +
  '\n  if (role) staticAttrs.role = role;' +
  '\n  var type = el.getAttribute("type");' +
  '\n  if (type) staticAttrs.type = type;' +
  '\n  var name = el.getAttribute("name");' +
  '\n  if (name) staticAttrs.name = name;' +
  '\n  return {' +
  '\n    tagPath: tagPath,' +
  '\n    tag: el.tagName.toLowerCase(),' +
  '\n    staticAttrs: staticAttrs,' +
  '\n    classes: Array.prototype.slice.call(el.classList),' +
  '\n    name: __bfComputedName(el)' +
  '\n  };' +
  '\n}' +
  '\n' +
  'function __bfChainFromElement(el) {' +
  '\n  var chain = [];' +
  '\n  var cursor = el;' +
  '\n  var depth = 0;' +
  '\n  while (cursor && cursor !== document.documentElement && depth < 6) {' +
  '\n    var parent = cursor.parentElement;' +
  '\n    var tag = cursor.tagName.toLowerCase();' +
  '\n    var indexAmongTag = 1;' +
  '\n    var sameTagSiblings = 0;' +
  '\n    if (parent) {' +
  '\n      var children = Array.prototype.slice.call(parent.children);' +
  '\n      for (var i = 0; i < children.length; i++) {' +
  '\n        if (children[i].tagName.toLowerCase() === tag) {' +
  '\n          sameTagSiblings++;' +
  '\n          if (children[i] === cursor) indexAmongTag = sameTagSiblings;' +
  '\n        }' +
  '\n      }' +
  '\n    } else {' +
  '\n      sameTagSiblings = 1;' +
  '\n    }' +
  '\n    var entry = {' +
  '\n      tag: tag,' +
  '\n      id: cursor.id || "",' +
  '\n      dataBf: (cursor.dataset && cursor.dataset.bf) || "",' +
  '\n      dataTestid: (cursor.dataset && cursor.dataset.testid) || "",' +
  '\n      indexAmongTag: indexAmongTag,' +
  '\n      sameTagSiblings: sameTagSiblings' +
  '\n    };' +
  '\n    chain.unshift(entry);' +
  '\n    cursor = parent;' +
  '\n    depth++;' +
  '\n  }' +
  '\n  return chain;' +
  '\n}' +
  '\n' +
  // __bfIsDynamicId must stay equivalent to isDynamicId in scripts/lib/structural-fp.mjs
'function __bfIsDynamicId(id) {' +
'\n  var s = String(id || "");' +
'\n  if (!s) return false;' +
'\n  return /^(mw[A-Za-z0-9]{2,}|ember\\d+)$|^(radix-|react-).|^[a-f0-9]{8,}$|^:r[a-z0-9]*:|:r.*:/.test(s);' +
'\n}' +
'\n' +
'function __bfImplicitRole(el) {' +
  '\n  var tag = el.tagName.toLowerCase();' +
  '\n  if (tag === "button") return "button";' +
  '\n  if (tag === "a" && el.getAttribute("href") !== null) return "link";' +
  '\n  if (tag === "textarea") return "textbox";' +
  '\n  if (tag === "select") return "combobox";' +
  '\n  if (tag === "summary") return "button";' +
  '\n  if (tag === "input") {' +
  '\n    var type = (el.getAttribute("type") || "text").toLowerCase();' +
  '\n    if (type === "checkbox") return "checkbox";' +
  '\n    if (type === "radio") return "radio";' +
  '\n    if (type === "submit" || type === "button" || type === "reset" || type === "image") return "button";' +
  '\n    return "textbox";' +
  '\n  }' +
  '\n  return "";' +
  '\n}' +
  '\n' +
  // optional scopeRule {ancestorUp, includeAncestorSiblingText} extends
  // the harvest beyond direct siblings + parent text to ancestor-sibling (uncle)
  // text — the model (scope-agent) decides how far, code can't know a priori.
  // Omitted scopeRule = legacy base scope (back-compat: capture-time +
  // un-scoped steps unchanged).
  'function __bfNeighborTexts(el, scopeRule) {' +
  '\n  var out = [];' +
  '\n  function add(s) { if (s) { var t = String(s).replace(/\\s+/g, " ").trim().slice(0, 60); if (t && out.indexOf(t) === -1 && out.length < 6) out.push(t); } }' +
  '\n  if (el.previousElementSibling) add(el.previousElementSibling.innerText);' +
  '\n  if (el.nextElementSibling) add(el.nextElementSibling.innerText);' +
  '\n  var p = el.parentElement;' +
  '\n  if (p) {' +
  '\n    var direct = "";' +
  '\n    for (var i = 0; i < p.childNodes.length; i++) { var n = p.childNodes[i]; if (n.nodeType === 3) direct += " " + n.nodeValue; }' +
  '\n    add(direct);' +
  '\n  }' +
  '\n  if (scopeRule && scopeRule.ancestorUp > 0) {' +
  '\n    var cur = el;' +
  '\n    for (var lvl = 0; lvl < scopeRule.ancestorUp && cur; lvl++) {' +
  '\n      cur = cur.parentElement;' +
  '\n      if (!cur) break;' +
  '\n      if (scopeRule.includeAncestorSiblingText) {' +
  '\n        if (cur.previousElementSibling) add(cur.previousElementSibling.innerText);' +
  '\n        if (cur.nextElementSibling) add(cur.nextElementSibling.innerText);' +
  '\n      }' +
  '\n    }' +
  '\n  }' +
  '\n  return out;' +
  '\n}' +
  '\n' +
  'function __bfCssPath(el) {' +
  '\n  if (!el || !el.tagName) return "";' +
  '\n  if (el.id && !__bfIsDynamicId(el.id)) return "#" + CSS.escape(el.id);' +
  '\n  if (el.dataset && el.dataset.bf) return "[data-bf=\\"" + el.dataset.bf + "\\"]";' +
  '\n  if (el.dataset && el.dataset.testid) return "[data-testid=\\"" + el.dataset.testid + "\\"]";' +
  '\n  var parts = [];' +
  '\n  var cur = el;' +
  '\n  while (cur && cur !== document.documentElement && parts.length < 4) {' +
  '\n    var tag = cur.tagName.toLowerCase();' +
  '\n    var parent = cur.parentElement;' +
  '\n    if (parent) {' +
  '\n      var siblings = Array.prototype.filter.call(parent.children, function(child) { return child.tagName === cur.tagName; });' +
  '\n      if (siblings.length > 1) tag += ":nth-of-type(" + (siblings.indexOf(cur) + 1) + ")";' +
  '\n    }' +
  '\n    parts.unshift(tag);' +
  '\n    cur = parent;' +
  '\n  }' +
  '\n  return parts.join(" > ");' +
  '\n}' +
  '\n' +
  'function __bfDirectHeadingText(region) {' +
  '\n  if (!region) return "";' +
  '\n  var headings = region.querySelectorAll("h1,h2,h3,h4,h5,h6,[role=heading]");' +
  '\n  for (var i = 0; i < headings.length; i++) {' +
  '\n    var t = (headings[i].innerText || headings[i].textContent || "").replace(/\\s+/g, " ").trim();' +
  '\n    if (t) return t.slice(0, 80);' +
  '\n  }' +
  '\n  return "";' +
  '\n}' +
  '\n' +
  'function __bfRegionLabel(region) {' +
  '\n  if (!region) return "";' +
  '\n  var aria = region.getAttribute("aria-label");' +
  '\n  if (aria && aria.trim()) return aria.replace(/\\s+/g, " ").trim().slice(0, 80);' +
  '\n  var labelledby = region.getAttribute("aria-labelledby");' +
  '\n  if (labelledby && labelledby.trim()) {' +
  '\n    var ids = labelledby.trim().split(/\\s+/);' +
  '\n    var parts = [];' +
  '\n    for (var i = 0; i < ids.length; i++) {' +
  '\n      var ref = document.getElementById(ids[i]);' +
  '\n      if (ref) parts.push((ref.textContent || "").trim());' +
  '\n    }' +
  '\n    var joined = parts.join(" ").replace(/\\s+/g, " ").trim();' +
  '\n    if (joined) return joined.slice(0, 80);' +
  '\n  }' +
  '\n  return "";' +
  '\n}' +
  '\n' +
  'function __bfFindSemanticRegion(el) {' +
  '\n  var cursor = el ? el.parentElement : null;' +
  '\n  var best = null;' +
  '\n  var depth = 0;' +
  '\n  while (cursor && cursor !== document.documentElement && depth < 8) {' +
  '\n    var tag = cursor.tagName.toLowerCase();' +
  '\n    var role = cursor.getAttribute("role") || "";' +
  '\n    var heading = __bfDirectHeadingText(cursor);' +
  '\n    var label = __bfRegionLabel(cursor);' +
  '\n    var regionish = /^(section|article|li|main|aside|nav)$/.test(tag) || /^(region|listitem|article|group|main)$/.test(role);' +
  '\n    if ((heading || label || regionish) && !(tag === "main" && !heading && !label)) {' +
  '\n      best = cursor;' +
  '\n      break;' +
  '\n    }' +
  '\n    cursor = cursor.parentElement;' +
  '\n    depth++;' +
  '\n  }' +
  '\n  return best;' +
  '\n}' +
  '\n' +
  'function __bfSemanticRegion(el) {' +
  '\n  var region = __bfFindSemanticRegion(el);' +
  '\n  if (!region) return undefined;' +
  '\n  var role = region.getAttribute("role") || region.tagName.toLowerCase();' +
  '\n  var heading = __bfDirectHeadingText(region);' +
  '\n  var label = __bfRegionLabel(region) || heading;' +
  '\n  var rr = region.getBoundingClientRect ? region.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };' +
  '\n  var er = el.getBoundingClientRect ? el.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };' +
  '\n  var name = __bfComputedName(el);' +
  '\n  var roleName = el.getAttribute("role") || __bfImplicitRole(el);' +
  '\n  var selector = "a,button,[role],[tabindex],input,textarea,select,summary,[contenteditable]";' +
  '\n  var all = Array.prototype.slice.call(document.querySelectorAll(selector));' +
  '\n  var samePage = all.filter(function(candidate) { return (candidate.getAttribute("role") || __bfImplicitRole(candidate)) === roleName && __bfComputedName(candidate) === name; }).length;' +
  '\n  var sameRegion = Array.prototype.slice.call(region.querySelectorAll(selector)).filter(function(candidate) { return (candidate.getAttribute("role") || __bfImplicitRole(candidate)) === roleName && __bfComputedName(candidate) === name; }).length;' +
  '\n  var x = rr.width > 0 ? ((er.left + er.width / 2) - rr.left) / rr.width : 0;' +
  '\n  var y = rr.height > 0 ? ((er.top + er.height / 2) - rr.top) / rr.height : 0;' +
  '\n  return {' +
  '\n    role: role,' +
  '\n    label: label,' +
  '\n    headingText: heading,' +
  '\n    regionText: (region.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 120),' +
  '\n    selector: __bfCssPath(region),' +
  '\n    sameNameCountPage: samePage,' +
  '\n    sameNameCountRegion: sameRegion,' +
  '\n    targetPosition: { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) },' +
  '\n    box: { cx: rr.left + rr.width / 2, cy: rr.top + rr.height / 2, w: rr.width, h: rr.height }' +
  '\n  };' +
  '\n}' +
  '\n' +
  'function __bfAffordanceSkeleton() {' +
  '\n  var els = document.querySelectorAll("a,button,[role],[tabindex],input,textarea,select,summary,[contenteditable]");' +
  '\n  var byKey = {};' +
  '\n  var ranked = [];' +
  '\n  for (var i = 0; i < els.length; i++) {' +
  '\n    var el = els[i];' +
  '\n    var entry = __bfSkeletonEntry(el);' +
  '\n    var key = entry.structuralKey;' +
  '\n    var rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };' +
  '\n    var style = window.getComputedStyle ? window.getComputedStyle(el) : null;' +
  '\n    var visible = !!(rect.width > 0 && rect.height > 0 && (!style || (style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity || "1") !== 0)));' +
  '\n    var viewportW = window.innerWidth || document.documentElement.clientWidth || 0;' +
  '\n    var viewportH = window.innerHeight || document.documentElement.clientHeight || 0;' +
  '\n    var inViewport = visible && rect.bottom >= 0 && rect.right >= 0 && rect.top <= viewportH && rect.left <= viewportW;' +
  '\n    var role = entry.role || "";' +
  '\n    var tag = el.tagName ? el.tagName.toLowerCase() : "";' +
  '\n    var interactable = /^(button|link|textbox|checkbox|radio|combobox|menuitem|tab|switch|slider|option)$/.test(role) || /^(button|a|input|textarea|select|summary)$/.test(tag);' +
  '\n    var chrome = /^(banner|menubar|navigation)$/.test(role) || tag === "nav";' +
  '\n    var score = 0;' +
  '\n    if (visible) score += 1000;' +
  '\n    if (inViewport) score += 1000;' +
  '\n    if (interactable) score += 500;' +
  '\n    if (entry.name) score += 50;' +
  '\n    if (chrome) score -= 250;' +
  '\n    score -= Math.max(0, Math.floor((rect.top || 0) / 200));' +
  '\n    var item = { entry: entry, score: score, order: i };' +
  '\n    if (!byKey[key] || item.score > byKey[key].score || (item.score === byKey[key].score && item.order < byKey[key].order)) byKey[key] = item;' +
  '\n  }' +
  '\n  for (var k in byKey) if (Object.prototype.hasOwnProperty.call(byKey, k)) ranked.push(byKey[k]);' +
  '\n  ranked.sort(function(a, b) { if (b.score !== a.score) return b.score - a.score; return a.order - b.order; });' +
  '\n  var out = [];' +
  '\n  for (var j = 0; j < ranked.length && out.length < 200; j++) {' +
  '\n    out.push(ranked[j].entry);' +
  '\n  }' +
  '\n  return out;' +
  '\n}' +
  '\n' +
  'function __bfElementSignals(el, scopeRule) {' +
  '\n  var rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };' +
  '\n  var style = window.getComputedStyle ? window.getComputedStyle(el) : null;' +
  '\n  var replay = __bfReplayIdentity(el);' +
  '\n  var disabled = !!el.disabled;' +
  '\n  var ariaDisabled = String(el.getAttribute("aria-disabled") || "").toLowerCase() === "true";' +
  '\n  var inert = !!el.inert || !!(el.closest && el.closest("[inert]"));' +
  '\n  var visible = !!(rect.width > 0 && rect.height > 0 && (!style || (style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity || "1") !== 0)));' +
  '\n  var actionable = !!(visible && !disabled && !ariaDisabled && !inert && (!style || style.pointerEvents !== "none"));' +
  '\n  return {' +
  '\n    role: el.getAttribute("role") || __bfImplicitRole(el),' +
  '\n    name: replay.name,' +
  '\n    structuralKey: __bfBuildStructuralKey(__bfDescriptorFromElement(el)),' +
  '\n    identityKey: replay.identityKey,' +
  '\n    identityShape: replay.identityShape,' +
  '\n    controlKind: replay.controlKind,' +
  '\n    textParts: replay.textParts,' +
  '\n    relXPath: __bfBuildRelXPath(__bfChainFromElement(el)),' +
  '\n    href: el.getAttribute("href") || "",' +
  '\n    neighborTexts: __bfNeighborTexts(el, scopeRule),' +
  '\n    semanticRegion: __bfSemanticRegion(el),' +
  '\n    cleanId: (el.id && !__bfIsDynamicId(el.id)) ? el.id : "",' +
  '\n    type: el.getAttribute("type") || "",' +
  '\n    alt: el.getAttribute("alt") || "",' +
  '\n    visible: visible,' +
  '\n    actionable: actionable,' +
  '\n    disabled: disabled,' +
  '\n    ariaDisabled: ariaDisabled,' +
  '\n    inert: inert,' +
  '\n    pointerEvents: style ? style.pointerEvents : "",' +
  '\n    display: style ? style.display : "",' +
  '\n    visibility: style ? style.visibility : "",' +
  '\n    opacity: style ? style.opacity : "",' +
  '\n    box: { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2, w: rect.width, h: rect.height }' +
  '\n  };' +
  '\n}' +
  '\n' +
  // Safety cap, not a relevance cut: a 200-cap silently DROPPED the target on
  // real link-heavy pages (ko.wikipedia 대한민국 has 3629 interactive elements;
  // the 토론 tab sits at document index 405 — never collected, never resolvable).
  // Full-signal collection of all 3629 measured ~636ms (one-off per resolution),
  // so we cap only to bound pathological pages. `i` is the true querySelectorAll
  // index, so winner re-resolution stays correct regardless of the cap.
  'function __bfCollectCandidates(scopeRule) {' +
  '\n  var els = document.querySelectorAll("a,button,[role],[tabindex],input,textarea,select,summary,[contenteditable]");' +
  '\n  var out = [];' +
  '\n  for (var i = 0; i < els.length && out.length < 5000; i++) {' +
  '\n    out.push({ i: i, signals: __bfElementSignals(els[i], scopeRule) });' +
  '\n  }' +
  '\n  return out;' +
  '\n}'
);
