// Offset Border – ES5-safe, draws a sibling rectangle behind each selection.
// No reparenting or moving of the original node.

var DEFAULTS = {
  gap: 8,
  strokeWidth: 1,
  strokeColor: { r: 0, g: 0, b: 0 },
  strokeAlign: "CENTER" // CENTER works well for 1px outlines
};

function getSettings() {
  return figma.clientStorage.getAsync("offset-border.settings").then(function(s) {
    if (!s) return DEFAULTS;
    // Merge manually for ES5
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

function absToLocal(parent, absX, absY) {
  var m = parent.absoluteTransform; // [[a,c,e],[b,d,f]]
  var a = m[0][0], c = m[0][1], e = m[0][2];
  var b = m[1][0], d = m[1][1], f = m[1][2];
  var det = a * d - b * c;
  var x = ( d * (absX - e) - c * (absY - f)) / det;
  var y = (-b * (absX - e) + a * (absY - f)) / det;
  return { x: x, y: y };
}

function getAbsBounds(node) {
  // Prefer absoluteRenderBounds if available
  if (node.absoluteRenderBounds) return node.absoluteRenderBounds;
  var t = node.absoluteTransform;
  return { x: t[0][2], y: t[1][2], width: node.width, height: node.height };
}

function addBorderRectBehind(node, settings) {
  var parent = node.parent;
  if (!parent || !("insertChild" in parent)) return null;

  var gap = settings.gap;
  var strokeWidth = settings.strokeWidth;
  var strokeColor = settings.strokeColor;
  var strokeAlign = settings.strokeAlign;

  var b = getAbsBounds(node);
  var absW = b.width  + 2 * gap;
  var absH = b.height + 2 * gap;
  var absX = b.x - gap;
  var absY = b.y - gap;

  var tl = absToLocal(parent, absX, absY);

  // Create border rect as sibling behind
  var rect = figma.createRectangle();
  rect.name = node.name + " – border";
  rect.resizeWithoutConstraints(absW, absH);
  rect.x = tl.x;
  rect.y = tl.y;
  rect.fills = []; // transparent
  rect.strokes = [colorToPaint(strokeColor)];
  rect.strokeWeight = strokeWidth;
  rect.strokeAlign = strokeAlign;

  var index = parent.children.indexOf(node);
  parent.insertChild(index, rect); // put behind node

  // Group rect + node (keeps same visual position)
  var group = figma.group([rect, node], parent);
  group.name = node.name + " + border";

  // Ensure rect stays behind inside the group
  group.insertChild(0, rect);
  group.insertChild(1, node);

  // Optional: copy corner radius if node is Rectangle
  try {
    if (node.type === "RECTANGLE" && typeof node.cornerRadius === "number") {
      rect.cornerRadius = node.cornerRadius;
    }
  } catch (e) {}

  return group;
}


function runApply() {
  getSettings().then(function(settings) {
    var sel = figma.currentPage.selection;
    if (!sel.length) {
      figma.notify("Select one or more layers to add an offset border.");
      figma.closePlugin();
      return;
    }
    var newSelection = [];
    sel.forEach(function(n) {
      if (!("width" in n) || !("height" in n)) return;
      var g = addBorderRectBehind(n, settings);
      if (g) newSelection.push(g);
    });
    if (newSelection.length) figma.currentPage.selection = newSelection;
    figma.notify("Offset border(s) added and grouped.");
    figma.closePlugin();
  });
}


function openConfig() {
  getSettings().then(function(s) {
    figma.showUI(__html__, { width: 320, height: 260 });
    figma.ui.postMessage({ type: "load", settings: s });

    figma.ui.onmessage = function(msg) {
      if (!msg) return;
      if (msg.type === "save") {
        var incoming = msg.settings || {};
        var filtered = {
          gap: typeof incoming.gap === "number" ? incoming.gap : DEFAULTS.gap,
          strokeWidth: typeof incoming.strokeWidth === "number" ? incoming.strokeWidth : DEFAULTS.strokeWidth,
          strokeColor: incoming.strokeColor && typeof incoming.strokeColor.r === "number" ? incoming.strokeColor : DEFAULTS.strokeColor,
          strokeAlign: incoming.strokeAlign || DEFAULTS.strokeAlign
        };
        setSettings(filtered).then(function() {
          figma.notify("Settings saved. Run “Add Offset Border”.");
          figma.closePlugin();
        });
      } else if (msg.type === "cancel") {
        figma.closePlugin();
      }
    };
  });
}

if (figma.command === "apply") runApply();
else openConfig();
