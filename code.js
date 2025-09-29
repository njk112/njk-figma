/***********************
 * Offset Border Plugin
 * ES5-safe, fast, batched
 ***********************/

/* ---------- Settings ---------- */

var DEFAULTS = {
  gap: 8, // px space between target and border
  strokeWidth: 1,
  strokeColor: { r: 0, g: 0, b: 0 }, // black
  strokeAlign: "CENTER"              // CENTER works well for 1px outline
};

function getSettings() {
  return figma.clientStorage.getAsync("offset-border.settings").then(function (s) {
    if (!s) return DEFAULTS;
    return {
      gap: typeof s.gap === "number" ? s.gap : DEFAULTS.gap,
      strokeWidth: typeof s.strokeWidth === "number" ? s.strokeWidth : DEFAULTS.strokeWidth,
      strokeColor: s.strokeColor && typeof s.strokeColor.r === "number" ? s.strokeColor : DEFAULTS.strokeColor,
      strokeAlign: s.strokeAlign || DEFAULTS.strokeAlign
    };
  });
}

function setSettings(s) {
  return figma.clientStorage.setAsync("offset-border.settings", s);
}

function colorToPaint(c) {
  return { type: "SOLID", color: c, opacity: 1 };
}

/* ---------- Fast math helpers (no absoluteRenderBounds) ---------- */

function mul2x3(m, x, y) {
  // m = [[a,c,e],[b,d,f]]
  return {
    x: m[0][0] * x + m[0][1] * y + m[0][2],
    y: m[1][0] * x + m[1][1] * y + m[1][2]
  };
}

function invert2x3(m) {
  var a = m[0][0], c = m[0][1], e = m[0][2];
  var b = m[1][0], d = m[1][1], f = m[1][2];
  var det = a * d - b * c;
  var ia = d / det, ic = -c / det, ie = (c * f - d * e) / det;
  var ib = -b / det, id = a / det, if_ = (b * e - a * f) / det;
  return [[ia, ic, ie], [ib, id, if_]];
}

function mulAbsByInvParent(absX, absY, inv) {
  return {
    x: inv[0][0] * absX + inv[0][1] * absY + inv[0][2],
    y: inv[1][0] * absX + inv[1][1] * absY + inv[1][2]
  };
}

// Axis-aligned ABS bounds from transform + size (fast even if rotated)
function getAbsAABB(node) {
  var t = node.absoluteTransform;
  var p1 = mul2x3(t, 0, 0);
  var p2 = mul2x3(t, node.width, 0);
  var p3 = mul2x3(t, 0, node.height);
  var p4 = mul2x3(t, node.width, node.height);
  var minX = Math.min(p1.x, p2.x, p3.x, p4.x);
  var maxX = Math.max(p1.x, p2.x, p3.x, p4.x);
  var minY = Math.min(p1.y, p2.y, p3.y, p4.y);
  var maxY = Math.max(p1.y, p2.y, p3.y, p4.y);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/* ---------- Border creation + grouping ---------- */

function addBorderRectBehindAndGroup(node, settings, parentCache, doGroup) {
  var parent = node.parent;
  if (!parent) return null;

  // Inverse transform of parent (Page has no transform: treat as identity)
  var inv = parentCache.get(parent);
  if (!inv) {
    if (parent.type === "PAGE") {
      inv = [[1,0,0],[0,1,0]];
    } else {
      inv = invert2x3(parent.absoluteTransform);
    }
    parentCache.set(parent, inv);
  }

  var gap = settings.gap;
  var strokeWidth = settings.strokeWidth;
  var strokeColor = settings.strokeColor;
  var strokeAlign = settings.strokeAlign;

  var b = getAbsAABB(node);
  var absW = b.width  + 2*gap;
  var absH = b.height + 2*gap;
  var absX = b.x - gap;
  var absY = b.y - gap;

  // Convert ABS -> parent's local coords (or identity for Page)
  var tl = (parent.type === "PAGE")
    ? { x: absX, y: absY }
    : mulAbsByInvParent(absX, absY, inv);

  var rect = figma.createRectangle();
  rect.name = node.name + " – border";
  rect.resizeWithoutConstraints(absW, absH);
  rect.x = tl.x;
  rect.y = tl.y;
  rect.fills = [];
  rect.strokes = [{ type:"SOLID", color: strokeColor, opacity: 1 }];
  rect.strokeWeight = strokeWidth;
  rect.strokeAlign = strokeAlign;

  // Put the rect in the same parent (append is fine; grouping will order)
  parent.appendChild(rect);

  if (!doGroup) return rect;

  // Group [rect, node] so rect is behind inside the group
  var group = figma.group([rect, node], parent);
  group.name = node.name + " + border";
  group.insertChild(0, rect);
  group.insertChild(1, node);
  return group;
}


/* ---------- Command: Add Offset Border (batched) ---------- */

function runApply() {
  getSettings().then(function (settings) {
    var sel = figma.currentPage.selection.slice();
    if (!sel.length) {
      figma.notify("Select one or more layers to add an offset border.");
      figma.closePlugin();
      return;
    }

    var parentCache = new Map();
    var out = [];
    var i = 0, N = sel.length;

    function step() {
      var count = 0;
      while (i < N && count < 50) {
        var n = sel[i++];
        try {
          var g = addBorderRectBehindAndGroup(n, settings, parentCache, true);
          if (g) out.push(g);
        } catch (e) { /* ignore single failures */ }
        count++;
      }
      if (i < N) {
        setTimeout(step, 0); // yield to UI
      } else {
        if (out.length) figma.currentPage.selection = out;
        figma.notify("Offset border(s) added and grouped (" + out.length + ").");
        figma.closePlugin();
      }
    }
    step();
  });
}

/* ---------- Configure UI ---------- */

function openConfig() {
  getSettings().then(function (s) {
    figma.showUI(__html__, { width: 320, height: 260 });
    figma.ui.postMessage({ type: "load", settings: s });

    figma.ui.onmessage = function (msg) {
      if (!msg) return;
      if (msg.type === "save") {
        var incoming = msg.settings || {};
        var filtered = {
          gap: typeof incoming.gap === "number" ? incoming.gap : DEFAULTS.gap,
          strokeWidth: typeof incoming.strokeWidth === "number" ? incoming.strokeWidth : DEFAULTS.strokeWidth,
          strokeColor: incoming.strokeColor && typeof incoming.strokeColor.r === "number" ? incoming.strokeColor : DEFAULTS.strokeColor,
          strokeAlign: incoming.strokeAlign || DEFAULTS.strokeAlign
        };
        setSettings(filtered).then(function () {
          figma.notify("Settings saved. Run “Add Offset Border” or “Master flow”.");
          figma.closePlugin();
        });
      } else if (msg.type === "cancel") {
        figma.closePlugin();
      }
    };
  });
}

/* ---------- Master flow ---------- */

// A4 at ~96dpi (210×297mm) -> 794×1123 px.
// Change if you prefer 595×842 (Figma preset) or 300dpi (2480×3508).
var A4_W = 1260;
var A4_H = 1785;
var PAGE_MARGIN = 50; // px each side
var CELL_GAP = 50;    // px between photos

// Target sizes (exact) per orientation:
var PORTRAIT_W = 230.4;
var PORTRAIT_H = 307.2;
var LAND_W = 307.2;
var LAND_H = 230.64;


var PAGE_NEAR_OFFSET_X = 120;   // put pages a bit to the right of selection
var PAGE_NEAR_OFFSET_Y = 0;     // same vertical level as selection

// Horizontal spacing between consecutive pages (so they form a row)
var PAGE_ROW_GAP = 200;

function isPortrait(node) { return node.height >= node.width; }

function resizePhotoExact(node) {
  if (!("resizeWithoutConstraints" in node)) return;
  if (isPortrait(node)) node.resizeWithoutConstraints(PORTRAIT_W, PORTRAIT_H);
  else node.resizeWithoutConstraints(LAND_W, LAND_H);
}

function computeSelectionAnchor(nodes) {
  var minX = Infinity, minY = Infinity, i, n, b;
  for (i = 0; i < nodes.length; i++) {
    n = nodes[i];
    if (!("width" in n) || !("height" in n)) continue;
    b = getAbsAABB(n);
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
  }
  if (!isFinite(minX) || !isFinite(minY)) return { x: 0, y: 0 };
  return { x: minX, y: minY };
}

function createA4Page(name) {
  var page = figma.createFrame();
  page.name = name;
  page.resizeWithoutConstraints(A4_W, A4_H);
  page.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  figma.currentPage.appendChild(page);
  return page;
}

function layoutGroupsIntoPages(groups, anchorAbs) {
  var usableW = A4_W - (PAGE_MARGIN * 2);
  var usableH = A4_H - (PAGE_MARGIN * 2);

  var pages = [];
  var pageIndex = 0;

  function makePage(i) {
    var p = figma.createFrame();
    p.name = "A4 Page " + (i + 1);
    p.resizeWithoutConstraints(A4_W, A4_H);
    p.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    figma.currentPage.appendChild(p);

    // Position in a horizontal row near the selection
    p.x = anchorAbs.x + PAGE_NEAR_OFFSET_X + i * (A4_W + PAGE_ROW_GAP);
    p.y = anchorAbs.y + PAGE_NEAR_OFFSET_Y;

    return p;
  }

  var page = makePage(pageIndex);
  pages.push(page);

  var x = PAGE_MARGIN;
  var y = PAGE_MARGIN;
  var rowH = 0;

  for (var i = 0; i < groups.length; i++) {
    var g = groups[i];
    var gw = g.width;
    var gh = g.height;

    // new row if width exceeded
    if (x > PAGE_MARGIN && x + gw > PAGE_MARGIN + usableW) {
      x = PAGE_MARGIN;
      y += rowH + CELL_GAP;
      rowH = 0;
    }

    // new page if height exceeded
    if (y + gh > PAGE_MARGIN + usableH) {
      // start a fresh page to the right
      pageIndex += 1;
      page = makePage(pageIndex);
      pages.push(page);
      x = PAGE_MARGIN;
      y = PAGE_MARGIN;
      rowH = 0;
    }

    // place group into current page
    page.appendChild(g);
    g.x = x;
    g.y = y;

    x += gw + CELL_GAP;
    if (gh > rowH) rowH = gh;
  }

  figma.currentPage.selection = pages;
}


function runMasterFlow() {
  getSettings().then(function(settings) {
    var sel = figma.currentPage.selection.slice();
    if (!sel.length) {
      figma.notify("Select one or more photos to run Master flow.");
      figma.closePlugin();
      return;
    }

    // Anchor near the current selection
    var anchor = computeSelectionAnchor(sel);

    // 1) Resize each selected layer by orientation
    sel.forEach(function(n) {
      if (!("width" in n) || !("height" in n)) return;
      try { resizePhoto(n); } catch (e) {}
    });

    // 2) Outline + group each
    var parentCache = new Map();
    var grouped = [];
    sel.forEach(function(n) {
      if (!("width" in n) || !("height" in n)) return;
      var g = addBorderRectBehindAndGroup(n, settings, parentCache, /*doGroup*/ true);
      if (g) grouped.push(g);
    });

    // 3) Create A4 pages near selection and pack in a row
    layoutGroupsIntoPages(grouped, anchor);

    figma.notify("Master flow complete: resized, outlined, and paginated (" + grouped.length + ").");
    figma.closePlugin();
  });
}


/* ---------- Entry point ---------- */

if (figma.command === "apply") runApply();
else if (figma.command === "master") runMasterFlow();
else openConfig();
