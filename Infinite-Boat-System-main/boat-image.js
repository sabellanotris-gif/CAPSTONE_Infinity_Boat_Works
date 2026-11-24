/* =========================================================
   BOAT IMAGE HELPER — frontend only.
   Maps saved orders/payments to a real, existing boat photo
   and provides one safe fallback for broken image sources.
   ========================================================= */
(function () {
  "use strict";

  var DEFAULT_BOAT_IMAGE = "./images/boat2.jpg";

  var BOAT_IMAGES = {
    "1950 Passenger Boat": "./images/1950(preview).png",
    "2680 Passenger Boat": "./images/2680 (preview).png",
    "Patrol Boat": "./images/patrol (preview).png",
    "Speed Boat": "./images/speed (preview).jpg",
    "Parasail Boat": "./images/parasail(preview).png"
  };

  // These used to be hardcoded as fallbacks but the files do not exist.
  var BROKEN_FALLBACKS = ["boat1.jpg", "boat.jpg"];

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function cleanName(value) {
    return text(value)
      .replace(/\s*\(custom\)\s*/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function isBroken(candidate) {
    var file = candidate.split(/[?#]/)[0].split("/").pop().toLowerCase();
    return BROKEN_FALLBACKS.indexOf(file) !== -1;
  }

  function nameImage(name) {
    var cleaned = cleanName(name);
    if (!cleaned) return "";

    if (Object.prototype.hasOwnProperty.call(BOAT_IMAGES, cleaned)) {
      return BOAT_IMAGES[cleaned];
    }

    // Match by distinctive words so "(Custom)" suffixes and saved variants
    // still resolve to the correct catalogue photo.
    if (/1950/.test(cleaned)) return BOAT_IMAGES["1950 Passenger Boat"];
    if (/2680/.test(cleaned)) return BOAT_IMAGES["2680 Passenger Boat"];
    if (/patrol/.test(cleaned)) return BOAT_IMAGES["Patrol Boat"];
    if (/speed/.test(cleaned)) return BOAT_IMAGES["Speed Boat"];
    if (/parasail|parasaril/.test(cleaned)) return BOAT_IMAGES["Parasail Boat"];

    if (cleaned.indexOf("passenger") !== -1) {
      return BOAT_IMAGES["1950 Passenger Boat"];
    }
    return "";
  }

  function sourceObject(input) {
    if (typeof input === "string") return { boatImage: input };
    return input && typeof input === "object" ? input : {};
  }

  function boatImageFor(input) {
    var item = sourceObject(input);
    var customConfig = item.customConfig || {};
    var candidates = [
      customConfig.boatPreviewImage,
      item.boatImage,
      item.image,
      item.photo
    ];

    for (var i = 0; i < candidates.length; i += 1) {
      var candidate = text(candidates[i]);
      if (!candidate || isBroken(candidate)) continue;
      return candidate;
    }

    var name = item.boatName || item.name || customConfig.boatName || "";
    return nameImage(name) || DEFAULT_BOAT_IMAGE;
  }

  function boatImageOnError(img) {
    if (!img) return;
    img.onerror = null;
    if (img.getAttribute("src") !== DEFAULT_BOAT_IMAGE) {
      img.src = DEFAULT_BOAT_IMAGE;
    }
  }

  window.BOAT_IMAGES = BOAT_IMAGES;
  window.DEFAULT_BOAT_IMAGE = DEFAULT_BOAT_IMAGE;
  window.boatImageFor = boatImageFor;
  window.boatImageOnError = boatImageOnError;
})();
