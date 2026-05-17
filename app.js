d3.json("./songs.json").then(dataset => {
  const songs = dataset.songs;
  const taxonomy = dataset.taxonomy || {};
  const genres = dataset.genres || {};
  const descriptors = dataset.descriptors || {};

  let currentSongList = [];
  let sortMode = "chart"; // chart
  let topSongsMode = "chart";
  let currentPanel = { type: null, key: null };
  let genreSortMode = "popular"; // az, za, popular, unpopular
  let countrySortMode = "popular";  // az, za, popular, unpopular
  let artistSortMode = "popular";
  let descriptorSortMode = "popular";
  let selectedYear = null;
  let selectedRank = null;
  let genreListView = "organized"; // "all" or "organized"
  let organizedGroupState = {};
  let descriptorListView = "organized"; // "all" or "organized"
  let organizedDescriptorGroupState = {};
  let organizedDescriptorSubgroupState = {};
  let mustContainAllSelectedGenres = false;
  let mustContainAllSelectedDescriptors = false;
  let selectedSongIndex = -1;
  let selectedSongRef = null;
  let selectedSongSide = "A";
  let isCurrentVideoPlaying = false;
  let youtubeMessageListenerBound = false;
  let songTitleFitResizeBound = false;
  let songTitleFitResizeRaf = 0;
  let songTitleMaxRenderedHeight = 0;
  let ratingMinFilter = 0.5;
  let ratingMaxFilter = 5;
  const accordionState = {
    song: true,
    selected: true,
    genres: false,
    descriptors: false,
    categories: false,
    countries: false,
    artists: false,
    ratings: false,
    about: false
  };

  const years = Array.from(new Set(songs.map(d => d.chartYear))).sort((a, b) => a - b);
  const ranks = d3.range(1, 11);
  const taxonomyOrder = ["hiphop","dance","soulrnb","rock","countryfolk","jazztraditionalpop"];

  function buildChartColgroupHtml(totalColumns) {
    const safeColumns = Math.max(1, Number(totalColumns) || 1);
    const dataColumns = Math.max(0, safeColumns - 1);
    return `
      <colgroup>
        <col class="chart-year-col">
        ${Array.from({ length: dataColumns }, () => '<col class="chart-data-col">').join("")}
      </colgroup>
    `;
  }

  // Collect all genres from json
  const allGenresSet = new Set();
  songs.forEach(s => {
    getAllSongGenres(s).forEach(g => allGenresSet.add(g));
  });
  const allGenresList = Array.from(allGenresSet).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  // Count genres
  let genreCounts = {};
  songs.forEach(s => {
    getAllSongGenres(s).forEach(g => {
      if (!g) return;
      genreCounts[g] = (genreCounts[g] || 0) + 1;
    });
  });
  
  // Track visibility for genres - default to SHOWN (true)
  let genreVisibility = {};
  allGenresList.forEach(g => { genreVisibility[g] = true; }); /* default shown */

  let taxonomyVisibility = {};
  Object.keys(taxonomy).forEach(t => { taxonomyVisibility[t] = true; }); /* default shown */

  // Collect all descriptors from json (both sides)
  const allDescriptorsSet = new Set();
  songs.forEach(s => {
    getAllSongDescriptors(s).forEach(d => allDescriptorsSet.add(d));
  });
  const allDescriptorsList = Array.from(allDescriptorsSet).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  // Count descriptors
  let descriptorCounts = {};
  songs.forEach(s => {
    getAllSongDescriptors(s).forEach(d => {
      if (!d) return;
      descriptorCounts[d] = (descriptorCounts[d] || 0) + 1;
    });
  });

  // Track visibility for descriptors - default to SHOWN (true)
  let descriptorVisibility = {};
  allDescriptorsList.forEach(d => { descriptorVisibility[d] = true; }); /* default shown */

  // Track visibility for countries and artists
  let countryVisibility = {};
  let artistVisibility = {};
  songs.forEach(s => {
    (s.countryCode || []).forEach(c => { countryVisibility[c] = true; });
    (s.artists || []).forEach(a => { artistVisibility[a] = true; });
  });

  function formatVisibleTotalCount(visibleCount, totalCount) {
    const visible = Number(visibleCount) || 0;
    const total = Number(totalCount) || 0;
    if (total <= 0) return "0/0";
    const safeVisible = Math.min(Math.max(0, visible), total);
    return `${safeVisible}/${total}`;
  }

  let visibleSongCountsCache = {
    songs: 0,
    genres: {},
    descriptors: {},
    taxonomy: {},
    countries: {},
    artists: {}
  };

  function recomputeVisibleSongCountsCache() {
    const visibleSongs = getVisibleSongs();

    const genreCounts = {};
    const descriptorCounts = {};
    const taxonomyCounts = {};
    const countryCounts = {};
    const artistCounts = {};

    visibleSongs.forEach((song) => {
      getAllSongGenres(song).forEach((g) => {
        if (!g) return;
        genreCounts[g] = (genreCounts[g] || 0) + 1;
      });

      getAllSongDescriptors(song).forEach((d) => {
        if (!d) return;
        descriptorCounts[d] = (descriptorCounts[d] || 0) + 1;
      });

      const t = song?.genretaxonomy;
      if (t) taxonomyCounts[t] = (taxonomyCounts[t] || 0) + 1;

      const countries = song?.countryCode;
      if (Array.isArray(countries)) {
        countries.forEach((c) => {
          if (!c) return;
          countryCounts[c] = (countryCounts[c] || 0) + 1;
        });
      } else if (typeof countries === "string" && countries) {
        countryCounts[countries] = (countryCounts[countries] || 0) + 1;
      }

      const artists = song?.artists;
      if (Array.isArray(artists)) {
        artists.forEach((a) => {
          if (!a) return;
          artistCounts[a] = (artistCounts[a] || 0) + 1;
        });
      } else if (typeof artists === "string" && artists) {
        artistCounts[artists] = (artistCounts[artists] || 0) + 1;
      }
    });

    visibleSongCountsCache = {
      songs: visibleSongs.length,
      genres: genreCounts,
      descriptors: descriptorCounts,
      taxonomy: taxonomyCounts,
      countries: countryCounts,
      artists: artistCounts
    };
  }

  let selectedGenreKeysCache = null;
  let selectedDescriptorKeysCache = null;

  function invalidateSelectedFilterKeysCache() {
    selectedGenreKeysCache = null;
    selectedDescriptorKeysCache = null;
  }

  function getSelectedGenreKeys() {
    if (!selectedGenreKeysCache) {
      selectedGenreKeysCache = Object.keys(genreVisibility).filter((k) => genreVisibility[k]);
    }
    return selectedGenreKeysCache;
  }

  function getSelectedDescriptorKeys() {
    if (!selectedDescriptorKeysCache) {
      selectedDescriptorKeysCache = Object.keys(descriptorVisibility).filter((k) => descriptorVisibility[k]);
    }
    return selectedDescriptorKeysCache;
  }

  // Tooltip
  const tooltip = d3.select("body").append("div").attr("id", "tooltip");
  let activeTooltipCell = null;
  let tooltipRepositionRaf = 0;

  function isMobileTooltipDisabled() {
    return window.matchMedia && window.matchMedia("(hover: none), (pointer: coarse), (max-width: 1100px)").matches;
  }

  function syncTooltipMaxWidth(cellNode) {
    const tooltipNode = tooltip.node();
    if (!tooltipNode) return;

    const tableNode = (cellNode && cellNode.closest(".chart-table")) || document.querySelector(".chart-table");
    if (!tableNode) {
      tooltip.style("max-width", "min(560px, calc(100vw - 20px))");
      return;
    }

    const gridCells = Array.from(tableNode.querySelectorAll(".chart-cell"));
    if (gridCells.length === 0) {
      tooltip.style("max-width", "min(560px, calc(100vw - 20px))");
      return;
    }

    let minGridLeft = Infinity;
    let maxGridRight = -Infinity;
    gridCells.forEach(cell => {
      const rect = cell.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      minGridLeft = Math.min(minGridLeft, rect.left);
      maxGridRight = Math.max(maxGridRight, rect.right);
    });

    if (!Number.isFinite(minGridLeft) || !Number.isFinite(maxGridRight) || maxGridRight <= minGridLeft) {
      tooltip.style("max-width", "min(560px, calc(100vw - 20px))");
      return;
    }

    const gridWidth = maxGridRight - minGridLeft;
    const gridInset = 12;
    const safeWidth = Math.max(220, Math.floor(gridWidth - (gridInset * 2)));
    tooltip.style("max-width", `${safeWidth}px`);
  }

  function fitTooltipTextToWidth() {
    const tooltipNode = tooltip.node();
    if (!tooltipNode) return;

    const fitOne = (selector, minPx = 11) => {
      const el = tooltipNode.querySelector(selector);
      if (!el) return;

      // Reset first so each hover/resize starts from the stylesheet size.
      el.style.fontSize = "";

      let fontSize = parseFloat(window.getComputedStyle(el).fontSize) || 16;
      const step = 0.5;

      while (el.scrollWidth > el.clientWidth && fontSize > minPx) {
        fontSize = Math.max(minPx, fontSize - step);
        el.style.fontSize = `${fontSize}px`;
      }
    };

    fitOne("h2", 10.5);
    fitOne(".tooltip-artist-line", 10.5);
  }

  function queueTooltipReposition() {
    if (!activeTooltipCell) return;
    if (tooltipRepositionRaf) cancelAnimationFrame(tooltipRepositionRaf);
    tooltipRepositionRaf = requestAnimationFrame(() => {
      tooltipRepositionRaf = 0;
      if (!activeTooltipCell || !activeTooltipCell.isConnected) return;
      syncTooltipMaxWidth(activeTooltipCell);
      fitTooltipTextToWidth();
      positionTooltipForCell(activeTooltipCell);
    });
  }

  window.addEventListener("resize", queueTooltipReposition);
  window.addEventListener("scroll", queueTooltipReposition, true);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", queueTooltipReposition);
    window.visualViewport.addEventListener("scroll", queueTooltipReposition);
  }

  function positionTooltipForCell(cellNode) {
    const tooltipNode = tooltip.node();
    if (!tooltipNode || !cellNode) return;

    const rect = cellNode.getBoundingClientRect();
    const viewportPadding = 10;
    const gridInset = 12;
    const tileGap = 10;

    tooltip.classed("tooltip-below", false);

    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;
    const viewport = window.visualViewport;
    const viewportLeft = scrollX + (viewport ? viewport.offsetLeft : 0);
    const viewportTop = scrollY + (viewport ? viewport.offsetTop : 0);
    const viewportWidth = viewport ? viewport.width : window.innerWidth;
    const viewportHeight = viewport ? viewport.height : window.innerHeight;

    const tooltipWidth = tooltipNode.offsetWidth;
    const tooltipHeight = tooltipNode.offsetHeight;

    const tableNode = cellNode.closest(".chart-table") || document.querySelector(".chart-table");
    if (!tableNode) {
      tooltip.classed("visible", false);
      return;
    }

    const gridCells = Array.from(tableNode.querySelectorAll(".chart-cell"));
    if (gridCells.length === 0) {
      tooltip.classed("visible", false);
      return;
    }

    let minGridLeft = Infinity;
    let minGridTop = Infinity;
    let maxGridRight = -Infinity;
    let maxGridBottom = -Infinity;

    gridCells.forEach(cell => {
      const cellRect = cell.getBoundingClientRect();
      if (cellRect.width <= 0 || cellRect.height <= 0) return;

      minGridLeft = Math.min(minGridLeft, cellRect.left);
      minGridTop = Math.min(minGridTop, cellRect.top);
      maxGridRight = Math.max(maxGridRight, cellRect.right);
      maxGridBottom = Math.max(maxGridBottom, cellRect.bottom);
    });

    if (
      !Number.isFinite(minGridLeft) ||
      !Number.isFinite(minGridTop) ||
      !Number.isFinite(maxGridRight) ||
      !Number.isFinite(maxGridBottom)
    ) {
      tooltip.classed("visible", false);
      return;
    }

    const gridLeft = scrollX + minGridLeft;
    const gridTop = scrollY + minGridTop;
    const gridRight = scrollX + maxGridRight;
    const gridBottom = scrollY + maxGridBottom;

    let minLeft = Math.max(gridLeft + gridInset, viewportLeft + viewportPadding);
    let maxLeft = Math.min(gridRight - tooltipWidth - gridInset, viewportLeft + viewportWidth - tooltipWidth - viewportPadding);
    let minTop = Math.max(gridTop + gridInset, viewportTop + viewportPadding);
    let maxTop = Math.min(gridBottom - tooltipHeight - gridInset, viewportTop + viewportHeight - tooltipHeight - viewportPadding);

    const controlsNode = document.querySelector(".sort-controls");
    if (controlsNode) {
      const controlsRect = controlsNode.getBoundingClientRect();
      minTop = Math.max(minTop, scrollY + controlsRect.bottom + tileGap);
    }

    // If available placement area is tighter than tooltip size, clamp to the nearest valid point
    // instead of hiding the tooltip.
    if (maxLeft < minLeft) maxLeft = minLeft;
    if (maxTop < minTop) maxTop = minTop;

    const cellLeft = scrollX + rect.left;
    const cellTop = scrollY + rect.top;
    const cellRight = scrollX + rect.right;
    const cellBottom = scrollY + rect.bottom;
    const cellCenterX = (cellLeft + cellRight) / 2;
    const cellCenterY = (cellTop + cellBottom) / 2;

    const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
    const intersectsTile = (left, top) => {
      const right = left + tooltipWidth;
      const bottom = top + tooltipHeight;
      return right > cellLeft && left < cellRight && bottom > cellTop && top < cellBottom;
    };

    const candidates = [
      {
        left: clamp(cellCenterX - (tooltipWidth / 2), minLeft, maxLeft),
        top: cellTop - tooltipHeight - tileGap,
        validAxis: (top) => top >= minTop
      },
      {
        left: clamp(cellCenterX - (tooltipWidth / 2), minLeft, maxLeft),
        top: cellBottom + tileGap,
        validAxis: (top) => top <= maxTop
      },
      {
        left: cellRight + tileGap,
        top: clamp(cellCenterY - (tooltipHeight / 2), minTop, maxTop),
        validAxis: (_, left) => left <= maxLeft
      },
      {
        left: cellLeft - tooltipWidth - tileGap,
        top: clamp(cellCenterY - (tooltipHeight / 2), minTop, maxTop),
        validAxis: (_, left) => left >= minLeft
      }
    ];

    let chosen = null;
    for (const candidate of candidates) {
      const left = candidate.left;
      const top = candidate.top;
      const axisOk = candidate.validAxis(top, left);
      if (!axisOk) continue;
      if (left < minLeft || left > maxLeft || top < minTop || top > maxTop) continue;
      if (intersectsTile(left, top)) continue;
      chosen = { left, top };
      break;
    }

    if (!chosen) {
      const fallbackLeft = clamp(cellCenterX - (tooltipWidth / 2), minLeft, maxLeft);
      const preferredTop = (cellBottom + tileGap <= maxTop)
        ? cellBottom + tileGap
        : cellTop - tooltipHeight - tileGap;
      const fallbackTop = clamp(preferredTop, minTop, maxTop);
      chosen = { left: fallbackLeft, top: fallbackTop };
    }

    tooltip
      .classed("visible", true)
      .style("left", `${chosen.left}px`)
      .style("top", `${chosen.top}px`);
  }

  function getContrastingTextColor(hexColor) {
    const hex = String(hexColor || "").trim().replace("#", "");
    const validHex = /^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(hex) ? hex : "3a3738";
    const expandedHex = validHex.length === 3
      ? validHex.split("").map(ch => ch + ch).join("")
      : validHex;

    const r = parseInt(expandedHex.slice(0, 2), 16);
    const g = parseInt(expandedHex.slice(2, 4), 16);
    const b = parseInt(expandedHex.slice(4, 6), 16);
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

    return luminance > 0.62 ? "#231f20" : "#f7fbff";
  }

  function getTaxonomyBadgeStyle(color) {
    const safeColor = color || "#3a3738";
    const textColor = getContrastingTextColor(safeColor);
    return `background-color: ${safeColor}; border-color: ${safeColor}; color: ${textColor};`;
  }

  // Taxonomy badges (rendered anywhere `.taxonomy-bar` exists)
  d3.selectAll(".taxonomy-bar").each(function() {
    const legend = d3.select(this);
    legend.html("");
    Object.entries(taxonomy).forEach(([key, info]) => {
      legend.append("span")
        .attr("class", "genre-badge clickable-taxonomy")
        .attr("style", getTaxonomyBadgeStyle(info.color))
        .attr("data-taxonomy", key)
        .text(info.label)
        .on("click", () => showTaxonomyPanel(key))
        .append("title")
        .text(info.description || "");
    });
  });

  function syncHeaderStickyOffset() {
    const headerNode = d3.select(".main-header").node();
    if (!headerNode) return;

    const measuredHeight = Math.ceil(headerNode.getBoundingClientRect().height);
    if (measuredHeight > 0) {
      document.documentElement.style.setProperty("--header-sticky-offset", `${measuredHeight}px`);
    }
  }

  // Run in a frame after layout settles so wrapped taxonomy rows are included.
  function queueHeaderStickyOffsetSync() {
    requestAnimationFrame(() => {
      syncHeaderStickyOffset();
    });
  }

  function getPlayButtonIconSvg(isPlaying) {
    if (isPlaying) {
      return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="6" y="5" width="4" height="14" rx="1"></rect><rect x="14" y="5" width="4" height="14" rx="1"></rect></svg>`;
    }
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 6 L19 12 L8 18 Z"></path></svg>`;
  }

  function getStepButtonIconSvg(direction) {
    if (direction === "prev") {
      return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M16 6 L9 12 L16 18 Z"></path><rect x="6" y="6" width="2" height="12" rx="1"></rect></svg>`;
    }
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 6 L15 12 L8 18 Z"></path><rect x="16" y="6" width="2" height="12" rx="1"></rect></svg>`;
  }

  function setCurrentVideoPlaying(nextPlaying) {
    isCurrentVideoPlaying = !!nextPlaying;
    const icon = getPlayButtonIconSvg(isCurrentVideoPlaying);
    const label = isCurrentVideoPlaying ? "Pause video" : "Play video";

    d3.selectAll("#play-first, #compact-play")
      .html(`<span class="play-icon">${icon}</span>`)
      .attr("title", label)
      .attr("aria-label", label);
  }

  function getCurrentVideoIframe() {
    return d3.select("#video-container iframe").node();
  }
// Song title fit behavior for selected song panel.

  function fitOpenSongTitle() {
    const titleNode = d3.select("#song-modal-cell .song-selected-title").node();
    if (!titleNode) return;
    const titleTextNode = titleNode.querySelector(".song-selected-title-text") || titleNode;

    const minOneLineFontPx = 32;
    const minTwoLineFontPx = 24;
    const step = 0.5;
    const defaultFontPx = 48;

    // Always reset font size to default before measuring.
    titleNode.style.minHeight = "";
    titleNode.style.setProperty("display", "flex", "important");
    titleNode.style.alignItems = "flex-end";
    titleNode.style.overflow = "hidden";
    titleNode.style.removeProperty("-webkit-box-orient");
    titleNode.style.removeProperty("-webkit-line-clamp");
    titleNode.style.removeProperty("line-clamp");

    titleTextNode.style.fontSize = `${defaultFontPx}px`;
    titleTextNode.style.display = "block";
    titleTextNode.style.width = "100%";
    titleTextNode.style.whiteSpace = "nowrap";
    titleTextNode.style.overflow = "hidden";
    titleTextNode.style.textOverflow = "clip";
    titleTextNode.style.overflowWrap = "normal";
    titleTextNode.style.removeProperty("-webkit-box-orient");
    titleTextNode.style.removeProperty("-webkit-line-clamp");
    titleTextNode.style.removeProperty("line-clamp");

    let fontSize = defaultFontPx;
    while (titleTextNode.scrollWidth > titleTextNode.clientWidth && fontSize > minOneLineFontPx) {
      fontSize = Math.max(minOneLineFontPx, fontSize - step);
      titleTextNode.style.fontSize = `${fontSize}px`;
    }

    // If still too long at one-line minimum, try fitting within two lines.
    if (titleTextNode.scrollWidth > titleTextNode.clientWidth) {
      titleTextNode.style.whiteSpace = "normal";
      titleTextNode.style.display = "-webkit-box";
      titleTextNode.style.setProperty("-webkit-box-orient", "vertical");
      titleTextNode.style.setProperty("-webkit-line-clamp", "2");
      titleTextNode.style.setProperty("line-clamp", "2");
      titleTextNode.style.overflow = "hidden";
      titleTextNode.style.textOverflow = "clip";
      titleTextNode.style.overflowWrap = "anywhere";

      // Keep shrinking until it fits in two lines or reaches two-line minimum font size.
      while (titleTextNode.scrollHeight > titleTextNode.clientHeight + 1 && fontSize > minTwoLineFontPx) {
        fontSize = Math.max(minTwoLineFontPx, fontSize - step);
        titleTextNode.style.fontSize = `${fontSize}px`;
      }

      // Never truncate title text with ellipsis: if still too long at minimum size,
      // allow it to wrap naturally beyond two lines.
      if (titleTextNode.scrollHeight > titleTextNode.clientHeight + 1) {
        titleTextNode.style.display = "block";
        titleTextNode.style.removeProperty("-webkit-box-orient");
        titleTextNode.style.removeProperty("-webkit-line-clamp");
        titleTextNode.style.removeProperty("line-clamp");
        titleTextNode.style.overflow = "visible";
      }
    }

    const measuredHeight = Math.ceil(titleNode.getBoundingClientRect().height || titleNode.scrollHeight || 0);
    if (measuredHeight > songTitleMaxRenderedHeight) {
      songTitleMaxRenderedHeight = measuredHeight;
    }
    if (songTitleMaxRenderedHeight > 0) {
      titleNode.style.minHeight = `${songTitleMaxRenderedHeight}px`;
    }
  }

  function ensureSongTitleFitResizeListener() {
    if (songTitleFitResizeBound) return;
    window.addEventListener("resize", () => {
      if (songTitleFitResizeRaf) cancelAnimationFrame(songTitleFitResizeRaf);
      songTitleFitResizeRaf = requestAnimationFrame(() => {
        songTitleMaxRenderedHeight = 0;
        fitOpenSongTitle();
      });
    });
    songTitleFitResizeBound = true;
  }

  function handleYouTubePlayerMessage(event) {
    const iframe = getCurrentVideoIframe();
    if (!iframe || !iframe.contentWindow || event.source !== iframe.contentWindow) return;

    let payload = event.data;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        return;
      }
    }

    if (!payload || typeof payload !== "object") return;

    let playerState;
    if (payload.event === "onStateChange" && typeof payload.info === "number") {
      playerState = payload.info;
    } else if (payload.event === "infoDelivery" && payload.info && typeof payload.info.playerState === "number") {
      playerState = payload.info.playerState;
    }

    if (playerState === 1) {
      setCurrentVideoPlaying(true);
    } else if (playerState === 2 || playerState === 0 || playerState === -1 || playerState === 5) {
      setCurrentVideoPlaying(false);
    }
  }

  function ensureYouTubeMessageListener() {
    if (youtubeMessageListenerBound) return;
    window.addEventListener("message", handleYouTubePlayerMessage);
    youtubeMessageListenerBound = true;
  }

  function registerCurrentYouTubePlayer() {
    const iframe = getCurrentVideoIframe();
    if (!iframe || !iframe.contentWindow) return;

    const post = (payload) => {
      iframe.contentWindow.postMessage(JSON.stringify(payload), "*");
    };

    // Register state events so native YouTube controls keep UI in sync.
    post({ event: "listening" });
    post({ event: "command", func: "addEventListener", args: ["onStateChange"] });
  }

  function sendYouTubePlayerCommand(command) {
    const iframe = getCurrentVideoIframe();
    if (!iframe || !iframe.contentWindow) return false;

    iframe.contentWindow.postMessage(
      JSON.stringify({ event: "command", func: command, args: [] }),
      "*"
    );
    return true;
  }

  function toggleCurrentVideoPlayback() {
    const hasPlayer = d3.select("#video-container iframe").node();
    if (!hasPlayer) return false;

    const nextIsPlaying = !isCurrentVideoPlaying;
    const command = nextIsPlaying ? "playVideo" : "pauseVideo";
    const sent = sendYouTubePlayerCommand(command);
    if (sent) setCurrentVideoPlaying(nextIsPlaying);
    return sent;
  }

  function showRelativeVisibleSong(step) {
    const visibleSongs = getVisibleSongs();
    if (visibleSongs.length === 0) return;

    const selectedSong = currentSongList[selectedSongIndex];
    const visibleSides = getVisibleSidesForSong(selectedSong);
    const currentSide = selectedSongSide;

    // Check if we can switch to the other side on the current song
    let switchToSide = null;
    if (step > 0) { // next
      if (currentSide === 'A' && visibleSides.includes('B')) {
        switchToSide = 'B';
      }
    } else { // prev
      if (currentSide === 'B' && visibleSides.includes('A')) {
        switchToSide = 'A';
      }
    }

    if (switchToSide) {
      showSongModal(selectedSongIndex, switchToSide, false, true, true);
      return;
    }

    // Move to next/prev song - always start on side A if visible, otherwise B
    const currentVisibleIndex = visibleSongs.indexOf(selectedSong);
    let targetVisibleIndex;
    if (currentVisibleIndex === -1) {
      targetVisibleIndex = step > 0 ? 0 : visibleSongs.length - 1;
    } else {
      targetVisibleIndex = (currentVisibleIndex + step + visibleSongs.length) % visibleSongs.length;
    }

    const targetSong = visibleSongs[targetVisibleIndex];
    const targetSongIndex = currentSongList.indexOf(targetSong);
    if (targetSongIndex !== -1) {
      // Always start on the preferred side for the new song
      const targetVisibleSides = getVisibleSidesForSong(targetSong);
      const startingSide = targetVisibleSides.includes('A') ? 'A' : 'B';
      showSongModal(targetSongIndex, startingSide, false, true, true);
    }
  }

  function playSelectedVisibleSongFromChartControls() {
    const visibleSongs = getVisibleSongs();
    if (visibleSongs.length === 0) return;

    const selectedSong = currentSongList[selectedSongIndex];
    const hasSelectedVisibleSong = !!selectedSong && visibleSongs.includes(selectedSong);

    if (hasSelectedVisibleSong) {
      if (d3.select("#video-container iframe").node()) {
        toggleCurrentVideoPlayback();
        return;
      }

      const selectedVisibleSongIndex = currentSongList.indexOf(selectedSong);
      if (selectedVisibleSongIndex !== -1) {
        showSongModal(selectedVisibleSongIndex, getPreferredVisibleSongSide(selectedSong), true, true);
        return;
      }
    }

    const firstVisibleSongIndex = currentSongList.indexOf(visibleSongs[0]);
    if (firstVisibleSongIndex !== -1) {
      showSongModal(firstVisibleSongIndex, getPreferredVisibleSongSide(visibleSongs[0]), true, true);
    }
  }

  function getChartSortModeText(mode) {
    return mode === "chart" ? "Chart" : "Genre";
  }

  function renderChartRankHeader() {
    const mount = d3.select("#chart-rank-header");
    if (mount.empty()) return;

    const isChartSort = sortMode === "chart";
    const isRankFiltered = isChartSort && selectedRank !== null;
    const ranksHtml = ranks.map(rank => {
      const isActive = isChartSort && selectedRank === rank;
      const classes = ["chart-rank-label"];
      if (isChartSort) classes.push("chart-rank-label-toggle");
      if (isActive) classes.push("chart-rank-label-active");
      const label = isChartSort ? `#${rank}` : `${rank}`;

      return `<td class="${classes.join(" ")}" data-rank="${rank}" ${isChartSort ? `role="button" tabindex="0" aria-pressed="${isActive ? "true" : "false"}" title="${isActive ? "Show all ranks" : `Show only rank #${rank}`}"` : ""}>${label}</td>`;
    }).join("");

    mount.style("display", null).html(`
      <table class="chart-rank-table ${isRankFiltered ? "rank-filter-active" : ""}" aria-hidden="true">
        ${buildChartColgroupHtml(ranks.length + 1)}
        <tbody>
          <tr>
            <td class="year-label chart-rank-spacer"></td>
            ${ranksHtml}
          </tr>
        </tbody>
      </table>
    `);

    if (isChartSort) {
      mount.selectAll(".chart-rank-label-toggle")
        .on("click", function() {
          const rank = Number(d3.select(this).attr("data-rank"));
          if (!Number.isFinite(rank)) return;
          selectedRank = selectedRank === rank ? null : rank;
          renderChartRankHeader();
          buildTable();
        })
        .on("keydown", function(event) {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          const rank = Number(d3.select(this).attr("data-rank"));
          if (!Number.isFinite(rank)) return;
          selectedRank = selectedRank === rank ? null : rank;
          renderChartRankHeader();
          buildTable();
        });
    }
  }

  function renderChartSortDropdownHtml(currentMode) {
    const allModes = ["genre", "chart"];
    const options = allModes.map(mode => {
      const selected = mode === currentMode ? ' sort-dropdown-option--selected' : '';
      return `<button type="button" class="sort-dropdown-option${selected}" data-chart-sort="${mode}">${getChartSortModeText(mode)}</button>`;
    }).join("");

    return `
      <div class="sort-dropdown" data-sort-dropdown="chart">
        <button type="button" id="sort-chart-btn" class="sort-dropdown-trigger" aria-haspopup="true" aria-expanded="false">
          ${getChartSortModeText(currentMode)} <span class="icon">&#x25BE;</span>
        </button>
        <div class="sort-dropdown-menu">
          <div class="sort-dropdown-title">Sort by</div>
          ${options}
        </div>
      </div>
    `;
  }

  function renderChartSortControl() {
    const mount = d3.select("#chart-sort-control");
    if (mount.empty()) return;

    mount.html(renderChartSortDropdownHtml(sortMode));

    const root = mount.select('[data-sort-dropdown="chart"]');
    const trigger = root.select(".sort-dropdown-trigger");
    trigger.on("click", function(event) {
      event.stopPropagation();
      const isOpen = root.classed("is-open");
      closeAllSortDropdowns();
      if (!isOpen) {
        root.classed("is-open", true);
        trigger.attr("aria-expanded", "true");
      }
    });

    root.selectAll(".sort-dropdown-option").on("click", function(event) {
      event.stopPropagation();
      const nextMode = d3.select(this).attr("data-chart-sort");
      if (nextMode && nextMode !== sortMode) {
        sortMode = nextMode;
        if (sortMode === "genre") selectedRank = null;
        renderChartRankHeader();
        buildTable();
        renderChartSortControl();
        return;
      }
      closeAllSortDropdowns();
    });
  }

  // Optional mobile nav shortcuts
  d3.selectAll(".nav-tab").on("click", function() {
    const tab = d3.select(this).attr("data-tab");
    if (tab === "genres") {
      accordionState.genres = true;
      renderGenreListCell();
      d3.select("#genres-cell").node()?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    else if (tab === "countries") {
      accordionState.countries = true;
      renderCountriesPanel();
      d3.select("#countries-cell").node()?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    else if (tab === "artists") {
      accordionState.artists = true;
      renderArtistsPanel();
      d3.select("#artists-cell").node()?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    else if (tab === "about") {
      accordionState.about = true;
      renderAboutPanel();
      d3.select("#about-cell").node()?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  // global utility functions
  function clearMainPanels() {
    d3.select("#genres-cell").html("");
    d3.select("#descriptors-cell").html("");
    d3.select("#categories-cell").html("");
    d3.select("#countries-cell").html("");
    d3.select("#artists-cell").html("");
    d3.select("#about-cell").html("");
    d3.selectAll(".nav-tab").classed("active", false);
    updateContextColumn();
  }
function updateContextColumn() {
    const allCells = d3.selectAll(".context-cell").nodes();
    allCells.forEach(n => {
      const html = n.innerHTML.trim();
      // hide empty cells, show cells with content
      if (html.length === 0) {
        d3.select(n).style("display", "none");
      } else {
        d3.select(n).style("display", null);
      }
    });
  }

  function refreshRenderedContextPanels({ preserveScroll = true } = {}) {
    const panels = [
      { selector: "#genres-cell", render: renderGenreListCell },
      { selector: "#descriptors-cell", render: renderDescriptorsListCell },
      { selector: "#categories-cell", render: renderCategoriesPanel },
      { selector: "#countries-cell", render: renderCountriesPanel },
      { selector: "#artists-cell", render: renderArtistsPanel },
      { selector: "#ratings-cell", render: renderRatingsPanel }
    ];

    panels.forEach(({ selector, render }) => {
      const node = d3.select(selector).node();
      if (!node) return;
      if (!node.innerHTML || node.innerHTML.trim().length === 0) return;

      const priorScrollTop = preserveScroll ? node.scrollTop : 0;
      try {
        render();
      } catch (error) {
        console.error("Panel refresh failed:", selector, error);
      }
      if (preserveScroll) node.scrollTop = priorScrollTop;
    });

    updateContextColumn();
  }

  function scrollLeftPanelToTop() {
    const infoCellNode = d3.select("#info-cell").node();
    if (infoCellNode) infoCellNode.scrollTop = 0;

    const contextColumnNode = d3.select(".context-column").node();
    if (contextColumnNode) contextColumnNode.scrollTop = 0;
  }

  function closeSongAccordion(immediate = false) {
    accordionState.song = false;

    const panel = d3.select('#song-modal-cell .accordion-panel[data-accordion-key="song"]');
    if (panel.empty()) return;

    const wasOpen = panel.classed("is-open");

    panel.classed("is-open", false).classed("is-closed", true);
    panel.select(".accordion-summary").style("display", "flex");
    panel.selectAll(".accordion-toggle").attr("aria-expanded", "false");

    const bodyNode = panel.select(".accordion-body").node();
    if (!bodyNode) return;

    // Clear any previous close listener so repeated close calls stay idempotent.
    if (bodyNode.__songAccordionCloseHandler) {
      bodyNode.removeEventListener("transitionend", bodyNode.__songAccordionCloseHandler);
      bodyNode.__songAccordionCloseHandler = null;
    }

    // If already closed, enforce collapsed state without re-running close animation.
    if (!wasOpen) {
      bodyNode.style.display = "none";
      bodyNode.style.maxHeight = "0px";
      bodyNode.style.opacity = "0";
      bodyNode.style.paddingTop = "0px";
      return;
    }

    if (immediate) {
      bodyNode.style.display = "none";
      bodyNode.style.maxHeight = "0px";
      bodyNode.style.opacity = "0";
      bodyNode.style.paddingTop = "0px";
      return;
    }

    bodyNode.style.display = "block";
    const currentHeight = bodyNode.scrollHeight;
    bodyNode.style.maxHeight = `${currentHeight}px`;
    bodyNode.style.opacity = "1";
    bodyNode.style.paddingTop = "12px";

    requestAnimationFrame(() => {
      bodyNode.style.maxHeight = "0px";
      bodyNode.style.opacity = "0";
      bodyNode.style.paddingTop = "0px";
    });

    const onCloseEnd = (event) => {
      if (event.propertyName !== "max-height") return;
      bodyNode.style.display = "none";
      bodyNode.removeEventListener("transitionend", onCloseEnd);
      bodyNode.__songAccordionCloseHandler = null;
    };
    bodyNode.__songAccordionCloseHandler = onCloseEnd;
    bodyNode.addEventListener("transitionend", onCloseEnd);
  }

  function renderAccordionCell(cellSelector, { key, title = "", headerMetaHtml = "", summaryHtml = "", bodyHtml = "", defaultOpen = true, headerBorderColor = "" }) {
    const cell = d3.select(cellSelector);
    if (!bodyHtml || !String(bodyHtml).trim()) {
      cell.classed("context-cell--accordion", false);
      cell.html("");
      updateContextColumn();
      return;
    }

    cell.classed("context-cell--accordion", true);

    if (accordionState[key] === undefined) accordionState[key] = defaultOpen;
    const isOpen = accordionState[key];
    const keepSummaryVisible = key === "song";
    const hasTitle = String(title).trim().length > 0;

    const titleButtonHtml = hasTitle
      ? `<button type="button" class="accordion-toggle accordion-toggle-title" data-accordion-key="${key}" aria-expanded="${isOpen ? "true" : "false"}">
            <span class="accordion-title">${title}</span>
         </button>`
      : "";

    const metaHtml = headerMetaHtml
      ? `<div class="accordion-title-meta">${headerMetaHtml}</div>`
      : "";

    const headerStyle = headerBorderColor
      ? ` style="border-color: ${headerBorderColor};"`
      : "";

    cell.html(`
      <div class="accordion-panel ${isOpen ? "is-open" : "is-closed"}" data-accordion-key="${key}">
        <div class="accordion-header"${headerStyle}>
          ${titleButtonHtml}
          ${metaHtml}
          <div class="accordion-summary" style="display:${(isOpen && !keepSummaryVisible) ? "none" : "flex"};">
            ${summaryHtml || ""}
          </div>
          <button type="button" class="accordion-toggle accordion-toggle-arrow" data-accordion-key="${key}" aria-expanded="${isOpen ? "true" : "false"}">
            <span class="accordion-arrow">&#x203A;</span>
          </button>
        </div>
        <div class="accordion-body">
          ${bodyHtml}
        </div>
      </div>
    `);

    function setPanelOpenState(panel, panelKey, nowOpen, immediate = false) {
      accordionState[panelKey] = nowOpen;
      const bodyNode = panel.select(".accordion-body").node();
      if (!bodyNode) return;

      panel.classed("is-open", nowOpen).classed("is-closed", !nowOpen);
      panel.select(".accordion-summary").style("display", (nowOpen && !keepSummaryVisible) ? "none" : "flex");
      panel.selectAll(".accordion-toggle").attr("aria-expanded", nowOpen ? "true" : "false");

      if (immediate) {
        bodyNode.style.display = nowOpen ? "block" : "none";
        bodyNode.style.maxHeight = nowOpen ? "none" : "0px";
        bodyNode.style.opacity = nowOpen ? "1" : "0";
        bodyNode.style.paddingTop = nowOpen ? "12px" : "0px";
        return;
      }

      if (nowOpen) {
        bodyNode.style.display = "block";
        bodyNode.style.maxHeight = "0px";
        bodyNode.style.opacity = "0";
        bodyNode.style.paddingTop = "0px";
        requestAnimationFrame(() => {
          bodyNode.style.maxHeight = `${bodyNode.scrollHeight}px`;
          bodyNode.style.opacity = "1";
          bodyNode.style.paddingTop = "12px";
        });
        const onOpenEnd = (event) => {
          if (event.propertyName !== "max-height") return;
          bodyNode.style.maxHeight = "none";
          bodyNode.removeEventListener("transitionend", onOpenEnd);
        };
        bodyNode.addEventListener("transitionend", onOpenEnd);
      } else {
        const currentHeight = bodyNode.scrollHeight;
        bodyNode.style.maxHeight = `${currentHeight}px`;
        bodyNode.style.opacity = "1";
        bodyNode.style.paddingTop = "12px";
        requestAnimationFrame(() => {
          bodyNode.style.maxHeight = "0px";
          bodyNode.style.opacity = "0";
          bodyNode.style.paddingTop = "0px";
        });
        const onCloseEnd = (event) => {
          if (event.propertyName !== "max-height") return;
          bodyNode.style.display = "none";
          bodyNode.removeEventListener("transitionend", onCloseEnd);
        };
        bodyNode.addEventListener("transitionend", onCloseEnd);
      }
    }

    const panelRoot = cell.select(".accordion-panel");
    setPanelOpenState(panelRoot, key, isOpen, true);

    cell.selectAll(".accordion-toggle").on("click", function () {
      const panelKey = d3.select(this).attr("data-accordion-key");
      const panel = d3.select(this.closest(".accordion-panel"));
      const nowOpen = !accordionState[panelKey];
      setPanelOpenState(panel, panelKey, nowOpen);
    });

    cell.selectAll(".accordion-header").on("click", function(event) {
      const panel = d3.select(this.closest(".accordion-panel"));
      const panelKey = panel.attr("data-accordion-key");

      const interactiveTarget = event.target.closest("button, input, a, label, .clickable-genre, .clickable-descriptor, .clickable-taxonomy, .clickable-country, .clickable-artist");
      if (interactiveTarget) return;

      const nowOpen = !accordionState[panelKey];
      setPanelOpenState(panel, panelKey, nowOpen);
    });

    updateContextColumn();
  }
  function updateStatusBar() {
    const visibleCount = visibleSongCountsCache.songs;
    const genreCount = Object.values(genreVisibility).filter(v => v).length;
    const taxonomyCount = Object.values(taxonomyVisibility).filter(v => v).length;
    const descriptorCount = Object.values(descriptorVisibility).filter(v => v).length;
    const countryCount = Object.values(countryVisibility).filter(v => v).length;
    const artistCount = Object.values(artistVisibility).filter(v => v).length;
    const totalGenres = Object.keys(genreVisibility).length;
    const totalTaxonomies = Object.keys(taxonomyVisibility).length;
    const totalDescriptors = Object.keys(descriptorVisibility).length;
    const totalCountries = Object.keys(countryVisibility).length;
    const totalArtists = Object.keys(artistVisibility).length;

    const fractionText = (count, total, { zeroMeansAll = false } = {}) => {
      if (!Number.isFinite(total) || total <= 0) return "0/0";
      const effectiveCount = (zeroMeansAll && count === 0) ? total : count;
      return `${effectiveCount}/${total}`;
    };

    const genreCountText = fractionText(genreCount, totalGenres, { zeroMeansAll: false });
    const taxonomyCountText = fractionText(taxonomyCount, totalTaxonomies, { zeroMeansAll: true });
    const descriptorCountText = fractionText(descriptorCount, totalDescriptors, { zeroMeansAll: false });
    const countryCountText = fractionText(countryCount, totalCountries, { zeroMeansAll: true });
    const artistCountText = fractionText(artistCount, totalArtists, { zeroMeansAll: true });
    const selectedYearText = selectedYear === null ? "All" : selectedYear;
    const selectedRankText = sortMode === "chart"
      ? (selectedRank === null ? "All" : `#${selectedRank}`)
      : "All";

    const status = `${visibleCount} song${visibleCount !== 1 ? "s" : ""}`;
    const songCountEl = d3.select("#song-count");

    songCountEl.html(`
      <div class="sort-dropdown" data-sort-dropdown="song-count">
        <button type="button" id="song-count-btn" class="sort-dropdown-trigger" aria-haspopup="true" aria-expanded="false">
          ${status} <span class="icon">&#x25BE;</span>
        </button>
        <div class="sort-dropdown-menu">
          <div class="sort-dropdown-title">Showing</div>
          <div class="song-count-dropdown-row">Years: ${selectedYearText}</div>
          <div class="song-count-dropdown-row">Ranks: ${selectedRankText}</div>
          <div class="song-count-dropdown-row">Genres: ${genreCountText}</div>
          <div class="song-count-dropdown-row">Descriptors: ${descriptorCountText}</div>
          <div class="song-count-dropdown-row">Categories: ${taxonomyCountText}</div>
          <div class="song-count-dropdown-row">Countries: ${countryCountText}</div>
          <div class="song-count-dropdown-row">Artists: ${artistCountText}</div>
        </div>
      </div>
    `);

    const root = songCountEl.select('[data-sort-dropdown="song-count"]');
    const trigger = root.select(".sort-dropdown-trigger");
    trigger.on("click", function(event) {
      event.stopPropagation();
      const isOpen = root.classed("is-open");
      closeAllSortDropdowns();
      if (!isOpen) {
        root.classed("is-open", true);
        trigger.attr("aria-expanded", "true");
      }
    });

    syncToggleAllButtonLabels();
  }
function toggleAllGlobal() {
  const allChecked = Object.values(genreVisibility).every(v => v) &&
                       Object.values(taxonomyVisibility).every(v => v) &&
                       Object.values(descriptorVisibility).every(v => v) &&
                       Object.values(countryVisibility).every(v => v) &&
                       Object.values(artistVisibility).every(v => v);
  const newState = !allChecked;

  // "Show all" should also clear chart year/rank filters.
  if (newState) {
    selectedYear = null;
    selectedRank = null;
    ratingMinFilter = 0.5;
    ratingMaxFilter = 5;
    mustContainAllSelectedGenres = false;
    mustContainAllSelectedDescriptors = false;
    d3.selectAll("#genres-must-contain-all, #descriptors-must-contain-all").property("checked", false);
  }

    Object.keys(genreVisibility).forEach(k => genreVisibility[k] = newState);
    Object.keys(taxonomyVisibility).forEach(k => taxonomyVisibility[k] = newState);
    Object.keys(descriptorVisibility).forEach(k => descriptorVisibility[k] = newState);
    Object.keys(countryVisibility).forEach(k => countryVisibility[k] = newState);
    Object.keys(artistVisibility).forEach(k => artistVisibility[k] = newState);
    invalidateSelectedFilterKeysCache();
    d3.selectAll(".genre-toggle, .taxonomy-toggle, .descriptor-toggle, .country-toggle, .artist-toggle").property("checked", newState);
    syncOrganizedGroupCheckboxes();
    syncOrganizedDescriptorGroupCheckboxes();
    syncOrganizedDescriptorSubgroupCheckboxes();
    renderChartRankHeader();
    buildTable();
    rerenderCurrentPanel(false);
    updateStatusBar();
  }
  function getChartScrollContainer() {
    // The chart scroll container is the element that actually scrolls the chart table.
    // CSS may move scrolling between `.chart-area` and `.chart-container`, so prefer
    // whichever currently has overflow/scroll content.
    const chartContainerNode = d3.select(".chart-container").node();
    if (chartContainerNode) return chartContainerNode;

    return d3.select(".chart-area").node() || document.scrollingElement || document.documentElement;
  }

  function getChartTopObstructionHeight(scroller) {
    const stickySelectors = [".sort-controls"];
    let obstructionBottom = 0;
    const scrollerRect = scroller?.getBoundingClientRect?.();

    stickySelectors.forEach(selector => {
      const node = d3.select(selector).node();
      if (!node) return;
      if (scroller && scroller !== document.documentElement && scroller !== document.body && !scroller.contains(node)) return;

      const rect = node.getBoundingClientRect();
      if (rect.height <= 0) return;

      const stickyTop = Number.parseFloat(window.getComputedStyle(node).top);
      if (Number.isFinite(stickyTop)) {
        obstructionBottom = Math.max(obstructionBottom, stickyTop + rect.height);
        return;
      }

      if (scrollerRect && Number.isFinite(scrollerRect.top)) {
        obstructionBottom = Math.max(obstructionBottom, rect.bottom - scrollerRect.top);
      } else if (rect.bottom > 0) {
        obstructionBottom = Math.max(obstructionBottom, rect.bottom);
      }
    });

    return obstructionBottom;
  }

  function scrollSelectedTileToTop(selectedCellNode) {
    if (!selectedCellNode) return;

    const scroller = getChartScrollContainer();
    const selectedRowGap = 8;
    const rowNode = selectedCellNode.closest("tr") || selectedCellNode;

    const computeTargetTop = () => {
      const rect = rowNode.getBoundingClientRect();
      const scrollerRect = scroller?.getBoundingClientRect?.();
      const topInScroller = scrollerRect ? rect.top - scrollerRect.top : rect.top;
      const obstruction = getChartTopObstructionHeight(scroller);
      const currentScrollTop = scroller?.scrollTop || 0;
      return Math.max(0, Math.round(currentScrollTop + topInScroller - obstruction - selectedRowGap));
    };

    if (typeof scroller?.scrollTo === "function") {
      scroller.scrollTo({ top: computeTargetTop(), behavior: "smooth" });
    } else {
      window.scrollTo({ top: computeTargetTop(), behavior: "smooth" });
    }
  }

  // hook global toggle button (chart + overlay)
  d3.selectAll("#toggle-all-global, #toggle-all-global-overlay").on("click", toggleAllGlobal);
  d3.select("#prev-first").on("click", () => {
    const isMobileOverlay = window.matchMedia && window.matchMedia("(max-width: 1100px)").matches;
    if (isMobileOverlay) {
      accordionState.song = true;
      if (typeof window.__goaSetMenuOpen === "function") window.__goaSetMenuOpen(true);
    }
    showRelativeVisibleSong(-1);
  });
  d3.select("#play-first").on("click", () => {
    playSelectedVisibleSongFromChartControls();
  });
  d3.select("#next-first").on("click", () => {
    const isMobileOverlay = window.matchMedia && window.matchMedia("(max-width: 1100px)").matches;
    if (isMobileOverlay) {
      accordionState.song = true;
      if (typeof window.__goaSetMenuOpen === "function") window.__goaSetMenuOpen(true);
    }
    showRelativeVisibleSong(1);
  });

  d3.select("#prev-first .play-icon").html(getStepButtonIconSvg("prev"));
  d3.select("#next-first .play-icon").html(getStepButtonIconSvg("next"));
  setCurrentVideoPlaying(false);


  // Table
  const table = d3.select(".chart-container").append("table").attr("class", "chart-table");
  const tbody = table.append("tbody");

  function applyChartTableColgroup(totalColumns) {
    const safeColumns = Math.max(1, Number(totalColumns) || 1);
    const dataColumns = Math.max(0, safeColumns - 1);

    table.select("colgroup").remove();
    const colgroup = table.insert("colgroup", ":first-child");
    colgroup.append("col").attr("class", "chart-year-col");
    for (let i = 0; i < dataColumns; i += 1) {
      colgroup.append("col").attr("class", "chart-data-col");
    }
  }

  queueHeaderStickyOffsetSync();
  window.addEventListener("resize", queueHeaderStickyOffsetSync);
  ensureSongTitleFitResizeListener();
  ensureYearLabelResizeListener();
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => queueHeaderStickyOffsetSync());
  }

  buildTable();
  renderChartSortControl();
  renderChartRankHeader();
  // populate static context cells (all available, collapsed by default)
  [renderGenreListCell, renderDescriptorsListCell, renderCategoriesPanel, renderCountriesPanel, renderArtistsPanel, renderRatingsPanel, renderAboutPanel].forEach((renderFn) => {
    try {
      renderFn();
    } catch (error) {
      console.error("Panel render failed:", error);
    }
  });

  function isYearLabelContracted() {
    return !!(window.matchMedia && window.matchMedia("(max-width: 380px)").matches);
  }

  function formatYearLabelText(yearValue) {
    const yearString = String(yearValue);
    return isYearLabelContracted() ? `'${yearString.slice(-2)}` : yearString;
  }

  function syncYearLabelText() {
    d3.selectAll(".year-label-toggle").each(function() {
      const el = d3.select(this);
      const rawYear = el.attr("data-year");
      if (!rawYear) return;
      el.text(formatYearLabelText(rawYear));
    });
  }

  let yearLabelResizeRaf = 0;
  function ensureYearLabelResizeListener() {
    if (ensureYearLabelResizeListener.bound) return;
    const onChange = () => {
      if (yearLabelResizeRaf) cancelAnimationFrame(yearLabelResizeRaf);
      yearLabelResizeRaf = requestAnimationFrame(() => syncYearLabelText());
    };

    window.addEventListener("resize", onChange);
    if (window.matchMedia) {
      const mq = window.matchMedia("(max-width: 380px)");
      if (typeof mq.addEventListener === "function") mq.addEventListener("change", onChange);
      else if (typeof mq.addListener === "function") mq.addListener(onChange);
    }
    ensureYearLabelResizeListener.bound = true;
  }

  function buildTable() {
    tbody.html("");
    currentSongList = [];
    const isYearFiltered = selectedYear !== null;
    const isRankFiltered = sortMode === "chart" && selectedRank !== null;
    table.classed("year-filter-active", isYearFiltered);

    function appendYearLabelCell(row, year) {
      const isSelected = selectedYear === year;
      row.append("td")
        .attr("class", "year-label year-label-toggle")
        .attr("data-year", year)
        .classed("year-label-active", isSelected)
        .attr("role", "button")
        .attr("tabindex", 0)
        .attr("aria-pressed", isSelected ? "true" : "false")
        .attr("title", isSelected ? "Show all years" : `Show only ${year}`)
        .text(formatYearLabelText(year))
        .on("click", () => {
          selectedYear = selectedYear === year ? null : year;
          buildTable();
        })
        .on("keydown", function(event) {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          selectedYear = selectedYear === year ? null : year;
          buildTable();
        });
    }

    if (sortMode === "chart") {
      applyChartTableColgroup(ranks.length + 1);
      // each row corresponds to a year; columns are ranks 1–10
      years.forEach(year => {
        const tr = tbody.append("tr");
        appendYearLabelCell(tr, year);
        const showYearSongs = !isYearFiltered || selectedYear === year;
        ranks.forEach(rank => {
          const showRankSongs = !isRankFiltered || selectedRank === rank;
          const shouldShowSong = showYearSongs && showRankSongs;
          const song = songs.find(d => d.chartYear === year && d.rank === rank);
          appendCell(tr, song, !shouldShowSong);
          if (shouldShowSong && song) currentSongList.push(song);
        });
      });
    } else {
      // taxonomy mode with visible songs pinned to right
      const songsByYear = {};
      years.forEach(year => {
        const yearSongs = songs.filter(d => d.chartYear === year);
        const visible = yearSongs.filter(isSongVisible);
        const hidden = yearSongs.filter(s => !isSongVisible(s));

        const sorter = (a, b) => {
          const ai = taxonomyOrder.indexOf(a.genretaxonomy);
          const bi = taxonomyOrder.indexOf(b.genretaxonomy);
          const A = ai === -1 ? taxonomyOrder.length : ai;
          const B = bi === -1 ? taxonomyOrder.length : bi;
          return A - B;
        };

        visible.sort(sorter);
        hidden.sort(sorter);
        songsByYear[year] = [...visible, ...hidden];
      });
      const maxCols = d3.max(Object.values(songsByYear), arr => arr.length) || 0;
      applyChartTableColgroup(maxCols + 1);
      years.forEach(year => {
        const tr = tbody.append("tr");
        appendYearLabelCell(tr, year);
        const showYearSongs = !isYearFiltered || selectedYear === year;
        for (let colIndex = 0; colIndex < maxCols; colIndex++) {
          const song = songsByYear[year][colIndex];
          appendCell(tr, song, !showYearSongs);
          if (showYearSongs && song) currentSongList.push(song);
        }
      });
    }
    syncSelectedSongCellSelection();
    // update helpers after rebuilding
    recomputeVisibleSongCountsCache();
    updateStatusBar();
    refreshRenderedContextPanels({ preserveScroll: true });
    updateContextColumn();
    syncYearLabelText();
  }

// Genre Filtering
function isSongVisible(song) {
  const songGenres = getAllSongGenres(song);
  const songDescriptors = getAllSongDescriptors(song);
  const songCountries = song.countryCode || [];
  const songArtists = song.artists || [];

  const anyTaxChecked = Object.values(taxonomyVisibility).some(v => v);
  const selectedGenres = getSelectedGenreKeys();
  const anyGenreChecked = selectedGenres.length > 0;
  const anyCountryChecked = Object.values(countryVisibility).some(v => v);
  const anyArtistChecked = Object.values(artistVisibility).some(v => v);
  const selectedDescriptors = getSelectedDescriptorKeys();
  const anyDescriptorChecked = selectedDescriptors.length > 0;

  const songGenreSet = mustContainAllSelectedGenres ? new Set(songGenres) : null;
  const songDescriptorSet = mustContainAllSelectedDescriptors ? new Set(songDescriptors) : null;

  let genreOk = false;
  if (!anyTaxChecked) {
    // With no taxonomy filter active, at least one checked genre must match.
    // If no genres are checked, show none.
    if (!anyGenreChecked) genreOk = false;
    else if (mustContainAllSelectedGenres) {
      if (selectedGenres.length > songGenreSet.size) genreOk = false;
      else genreOk = selectedGenres.every((g) => songGenreSet.has(g));
    } else {
      genreOk = songGenres.some(g => genreVisibility[g]);
    }
  } else {
    const taxOk = taxonomyVisibility[song.genretaxonomy];
    if (!taxOk) genreOk = false;
    else if (!anyGenreChecked) genreOk = true;
    else if (mustContainAllSelectedGenres) {
      if (selectedGenres.length > songGenreSet.size) genreOk = false;
      else genreOk = selectedGenres.every((g) => songGenreSet.has(g));
    } else {
      genreOk = songGenres.some(g => genreVisibility[g]);
    }
  }

  // Country + artist filtering
  const countryOk = !anyCountryChecked || songCountries.some(c => countryVisibility[c]);
  const artistOk = !anyArtistChecked || songArtists.some(a => artistVisibility[a]);

  let descriptorOk = false;
  if (!anyDescriptorChecked) descriptorOk = true;
  else if (mustContainAllSelectedDescriptors) {
    if (selectedDescriptors.length > songDescriptorSet.size) descriptorOk = false;
    else descriptorOk = selectedDescriptors.every((d) => songDescriptorSet.has(d));
  } else {
    descriptorOk = songDescriptors.some(d => descriptorVisibility[d]);
  }

  // Side visibility must satisfy the intersection of side-aware filters (genre/descriptor/rating).
  // This avoids showing a song when (e.g.) one side matches the genre filter but the *other* side
  // is the only one that matches the rating range.
  const visibleSides = getVisibleSidesForSong(song);
  const sideOk = Array.isArray(visibleSides) && visibleSides.length > 0;

  return genreOk && descriptorOk && countryOk && artistOk && sideOk;
}

  // Single table cell for each song
  function appendCell(row, song, forceEmpty = false) {
    const cell = row.append("td").attr("class", "chart-cell").classed("empty", !song);
    if (song) {
      cell.datum(song); // Bind song data to cell for selection tracking
      if (forceEmpty || !isSongVisible(song)) {
        cell.classed("empty", true).style("background-color", "");
        return;
      }
      cell.style("background-color", taxonomy[song.genretaxonomy]?.color || "#2c292b");

      // Print/title helpers: store which side(s) are currently "visible" under the genre filter.
      // This lets print/export or any CSS that surfaces titles show A, B, or A/B correctly.
      const visibleSides = getVisibleSidesForSong(song);
      const titleA = song?.tracks?.[0]?.title || "";
      const titleB = song?.tracks?.[1]?.title || "";
      const combinedTitle = titleB ? `${titleA} / ${titleB}` : titleA;
      const effectiveSide = getEffectiveVisibleSongSide(song);
      const preferredTitle = effectiveSide === "B" ? (titleB || titleA) : titleA;
      const printTitle = visibleSides.length === 2 ? combinedTitle : getSongTitleForSides(song, visibleSides);

      cell
        .attr("data-visible-sides", visibleSides.join(""))
        .attr("data-title-a", titleA)
        .attr("data-title-b", titleB)
        .attr("data-title-combined", combinedTitle)
        .attr("data-title-preferred", preferredTitle)
        .attr("data-title-print", printTitle)
        .attr("title", null);

      cell.append("span")
        .attr("class", "chart-cell-print-title")
        .text(printTitle);
    }
    // Tooltip 
    cell.on("mouseenter", function () {
      if (!song || isMobileTooltipDisabled()) return;
      const hoverSide = getEffectiveVisibleSongSide(song);
      const track = hoverSide === "B" ? song.tracks?.[1] : song.tracks?.[0];
      const trackTitle = getFilteredHoverTitleForSong(song) || track?.title || song.tracks?.[0]?.title || "";

      activeTooltipCell = this;
      const artistSeparator = getSongArtistSeparator(song);
      const filteredArtists = getFilteredHoverArtistsForSong(song);
      const sideGenres = getSongGenresForSide(song, hoverSide);
      const sideGenreList = [sideGenres.primarygenre, ...(sideGenres.subgenres || [])].filter(Boolean);
      const genreLabel = sideGenreList.find(g => genreVisibility[g]) || sideGenres.primarygenre || song.primarygenre || "";
      tooltip.classed("visible", true).html(`
        <h2>${trackTitle}</h2>
        <p class="tooltip-artist-line">${filteredArtists.join(artistSeparator)}</p>
        <p class="tooltip-rank-genre-line">#${song.rank} for ${song.chartYear} • ${genreLabel}</p>
      `);
      syncTooltipMaxWidth(this);
      fitTooltipTextToWidth();
      positionTooltipForCell(this);
    })
    .on("mousemove", function() {
      if (!song || isMobileTooltipDisabled()) return;
      activeTooltipCell = this;
      queueTooltipReposition();
    })
    .on("mouseleave", function() {
      if (isMobileTooltipDisabled()) return;
      if (activeTooltipCell === this) activeTooltipCell = null;
      tooltip.classed("visible", false);
    })
    .on("click", () => {
      if (!song) return;
      let songIndex = currentSongList.indexOf(song);
      if (songIndex === -1) songIndex = currentSongList.findIndex(s => s.chartYear === song.chartYear && s.rank === song.rank);
      if (songIndex === -1) return;
      const visibleSides = getVisibleSidesForSong(song);
      const clickSide = visibleSides.includes("A") ? "A" : visibleSides[0] || "A";

      const isMobileOverlay = window.matchMedia && window.matchMedia("(max-width: 1100px)").matches;
      if (isMobileOverlay) {
        // Ensure the song accordion is opened when selecting from the chart on mobile.
        accordionState.song = true;
        if (typeof window.__goaSetMenuOpen === "function") {
          window.__goaSetMenuOpen(true);
        }
      }

      showSongModal(songIndex, clickSide, false, false, true);
    });
  }

  function getVisibleSongs() {
    return currentSongList.filter(isSongVisible);
  }

  function syncSelectedSongCellSelection() {
    d3.selectAll(".chart-cell").classed("selected", false);

    if (!selectedSongRef) {
      selectedSongIndex = -1;
      return null;
    }

    selectedSongIndex = currentSongList.indexOf(selectedSongRef);

    let selectedCellNode = null;
    d3.selectAll(".chart-cell").each(function() {
      const cellSong = d3.select(this).datum();
      if (cellSong === selectedSongRef) {
        d3.select(this).classed("selected", true);
        selectedCellNode = this;
      }
    });

    return selectedCellNode;
  }

  function rerenderCurrentPanel(resetScroll = false) {
    if (!currentPanel.type) return;
    if (currentPanel.type === "taxonomy") showTaxonomyPanel(currentPanel.key, resetScroll, false);
    else if (currentPanel.type === "genre") showGenrePanel(currentPanel.key, resetScroll, false);
    else if (currentPanel.type === "descriptor") showDescriptorPanel(currentPanel.key, resetScroll, false);
    else if (currentPanel.type === "country") showCountryPanel(currentPanel.key, resetScroll, false);
    else if (currentPanel.type === "artist") showArtistPanel(currentPanel.key, resetScroll, false);
  }


// panel tabs and open button removed; context cells will display information directly

function getToggleAllLabelFor(obj) {
  const allChecked = Object.values(obj).every(v => v);
  return allChecked ? "Hide all" : "Show all";
}

function syncToggleAllButtonLabels() {
  const allGlobalChecked = Object.values(genreVisibility).every(v => v) &&
                           Object.values(taxonomyVisibility).every(v => v) &&
                           Object.values(descriptorVisibility).every(v => v) &&
                           Object.values(countryVisibility).every(v => v) &&
                           Object.values(artistVisibility).every(v => v);

  const allGenresChecked = Object.values(genreVisibility).every(v => v) &&
                           Object.values(taxonomyVisibility).every(v => v);

  d3.selectAll("#toggle-all-global, #toggle-all-global-overlay").text(allGlobalChecked ? "Hide all" : "Show all");
  d3.select("#toggle-all-genres").text(allGenresChecked ? "Hide all" : "Show all");
  d3.select("#toggle-all-descriptors").text(Object.values(descriptorVisibility).every(v => v) ? "Hide all" : "Show all");
  d3.select("#toggle-all-categories").text(Object.values(taxonomyVisibility).every(v => v) ? "Hide all" : "Show all");
  d3.select("#toggle-all-countries").text(getToggleAllLabelFor(countryVisibility));
  d3.select("#toggle-all-artists").text(getToggleAllLabelFor(artistVisibility));
}

function getSortModeText(mode) {
  if (mode === "popular") return "Most";
  if (mode === "unpopular") return "Least";
  if (mode === "az") return "A-Z";
  if (mode === "za") return "Z-A";
  return "Sort";
}

function getSortDropdownTriggerLabel(mode) {
  return `${getSortModeText(mode)} <span class="icon">&#x25BE;</span>`;
}

function renderSortDropdownHtml(dropdownKey, currentMode) {
  const sortModeSequence = ["popular", "unpopular", "az", "za"];
  const optionsHtml = sortModeSequence.map(mode => {
    const selected = mode === currentMode ? ' sort-dropdown-option--selected' : '';
    return `<button type="button" class="sort-dropdown-option${selected}" data-sort-value="${mode}">${getSortModeText(mode)}</button>`;
  }).join("");

  return `
    <div class="sort-dropdown" data-sort-dropdown="${dropdownKey}">
      <button type="button" id="sort-${dropdownKey}-btn" class="sort-dropdown-trigger" aria-haspopup="true" aria-expanded="false">
        ${getSortDropdownTriggerLabel(currentMode)}
      </button>
      <div class="sort-dropdown-menu">
        <div class="sort-dropdown-title">Sort by</div>
        ${optionsHtml}
      </div>
    </div>
  `;
}

function getGenreListViewText(view) {
  return view === "all" ? "Full List" : "Sorted";
}

function renderGenreViewDropdownHtml(currentView) {
  const allViews = ["organized", "all"];
  const options = allViews.map(view => {
    const selected = view === currentView ? ' sort-dropdown-option--selected' : '';
    return `<button type="button" class="sort-dropdown-option${selected}" data-genre-view="${view}">${getGenreListViewText(view)}</button>`;
  }).join("");

  return `
    <div class="sort-dropdown" data-sort-dropdown="genre-view">
      <button type="button" id="genre-view-btn" class="sort-dropdown-trigger" aria-haspopup="true" aria-expanded="false">
        ${getGenreListViewText(currentView)} <span class="icon">&#x25BE;</span>
      </button>
      <div class="sort-dropdown-menu">
        <div class="sort-dropdown-title">Genres</div>
        ${options}
      </div>
    </div>
  `;
}

function getDescriptorListViewText(view) {
  return view === "all" ? "Full List" : "Sorted";
}

function renderDescriptorViewDropdownHtml(currentView) {
  const allViews = ["organized", "all"];
  const options = allViews.map(view => {
    const selected = view === currentView ? ' sort-dropdown-option--selected' : '';
    return `<button type="button" class="sort-dropdown-option${selected}" data-descriptor-view="${view}">${getDescriptorListViewText(view)}</button>`;
  }).join("");

  return `
    <div class="sort-dropdown" data-sort-dropdown="descriptor-view">
      <button type="button" id="descriptor-view-btn" class="sort-dropdown-trigger" aria-haspopup="true" aria-expanded="false">
        ${getDescriptorListViewText(currentView)} <span class="icon">&#x25BE;</span>
      </button>
      <div class="sort-dropdown-menu">
        <div class="sort-dropdown-title">Descriptors</div>
        ${options}
      </div>
    </div>
  `;
}

function closeAllSortDropdowns() {
  d3.selectAll(".sort-dropdown")
    .classed("is-open", false)
    .select(".sort-dropdown-trigger")
    .attr("aria-expanded", "false");
}

function bindSortDropdown(dropdownKey, currentMode, setMode, rerender) {
  const root = d3.select(`[data-sort-dropdown="${dropdownKey}"]`);
  if (root.empty()) return;

  const trigger = root.select(".sort-dropdown-trigger");
  trigger.on("click", function(event) {
    event.stopPropagation();
    const isOpen = root.classed("is-open");
    closeAllSortDropdowns();
    if (!isOpen) {
      root.classed("is-open", true);
      trigger.attr("aria-expanded", "true");
    }
  });

  root.selectAll(".sort-dropdown-option").on("click", function(event) {
    event.stopPropagation();
    const nextMode = d3.select(this).attr("data-sort-value");
    if (nextMode && nextMode !== currentMode()) {
      setMode(nextMode);
      rerender();
      return;
    }
    closeAllSortDropdowns();
  });
}

function bindGenreViewDropdown() {
  const root = d3.select('[data-sort-dropdown="genre-view"]');
  if (root.empty()) return;

  const trigger = root.select(".sort-dropdown-trigger");
  trigger.on("click", function(event) {
    event.stopPropagation();
    const isOpen = root.classed("is-open");
    closeAllSortDropdowns();
    if (!isOpen) {
      root.classed("is-open", true);
      trigger.attr("aria-expanded", "true");
    }
  });

  root.selectAll(".sort-dropdown-option").on("click", function(event) {
    event.stopPropagation();
    const nextView = d3.select(this).attr("data-genre-view");
    if (nextView && nextView !== genreListView) {
      genreListView = nextView;
      renderGenreListCell();
      return;
    }
    closeAllSortDropdowns();
  });
}

function bindDescriptorViewDropdown() {
  const root = d3.select('[data-sort-dropdown="descriptor-view"]');
  if (root.empty()) return;

  const trigger = root.select(".sort-dropdown-trigger");
  trigger.on("click", function(event) {
    event.stopPropagation();
    const isOpen = root.classed("is-open");
    closeAllSortDropdowns();
    if (!isOpen) {
      root.classed("is-open", true);
      trigger.attr("aria-expanded", "true");
    }
  });

  root.selectAll(".sort-dropdown-option").on("click", function(event) {
    event.stopPropagation();
    const nextView = d3.select(this).attr("data-descriptor-view");
    if (nextView && nextView !== descriptorListView) {
      descriptorListView = nextView;
      renderDescriptorsListCell();
      return;
    }
    closeAllSortDropdowns();
  });
}

function getFlagIconClass(countryCode) {
  const normalized = String(countryCode || "").trim().toUpperCase();
  if (!normalized) return "";

  const countryAlias = {
    UK: "GB",
    USA: "US",
    EL: "GR",
    AUSTRALIA: "AU",
    AUSTRIA: "AT",
    BARBADOS: "BB",
    BELGIUM: "BE",
    CANADA: "CA",
    COLOMBIA: "CO",
    CUBA: "CU",
    DENMARK: "DK",
    FINLAND: "FI",
    FRANCE: "FR",
    GERMANY: "DE",
    HAITI: "HT",
    IRELAND: "IE",
    ITALY: "IT",
    JAMAICA: "JM",
    KAZAKHSTAN: "KZ",
    LEBANON: "LB",
    NETHERLANDS: "NL",
    "NEW ZEALAND": "NZ",
    NIGERIA: "NG",
    "PUERTO RICO": "PR",
    "SAINT LUCIA": "LC",
    "SOUTH KOREA": "KR",
    SPAIN: "ES",
    SWEDEN: "SE",
    "TRINIDAD AND TOBAGO": "TT"
  };

  const isoCode = countryAlias[normalized] || normalized;
  if (!/^[A-Z]{2}$/.test(isoCode)) return "";

  return `fi fi-${isoCode.toLowerCase()}`;
}

  d3.select(document)
  .on("click.sortDropdown", () => closeAllSortDropdowns())
  .on("keydown.sortDropdown", function(event) {
    if (event.key === "Escape") closeAllSortDropdowns();
  });

// Categories (taxonomy) panel
function renderCategoriesPanel() {
  const orderedKeys = [
    ...taxonomyOrder.filter(k => taxonomy[k]),
    ...Object.keys(taxonomy).filter(k => !taxonomyOrder.includes(k)).sort((a, b) => a.localeCompare(b))
  ].reverse();

  const allChecked = Object.values(taxonomyVisibility).every(v => v);
  const toggleAllLabel = allChecked ? "Hide all" : "Show all";

  const categoriesBodyHtml = `
    <p class="panel-description">The base genres used to categorise the songs.</p>
    <div class="panel-controls-row">
      <button id="toggle-all-categories">${toggleAllLabel}</button>
    </div>
    <br>
    <ul>
      ${orderedKeys.map(tKey => {
        const info = taxonomy[tKey] || {};
        const label = info.label || tKey;
        const totalCount = songs.filter(s => s.genretaxonomy === tKey).length;
        const visibleCount = visibleSongCountsCache.taxonomy[tKey] || 0;
        return `
          <li>
            <input type="checkbox" class="taxonomy-toggle" data-taxonomy="${tKey}" ${taxonomyVisibility[tKey] !== false ? "checked" : ""}>
            <span class="genre-badge clickable-taxonomy" data-taxonomy="${tKey}" style="${getTaxonomyBadgeStyle(info.color || "")}">${label}</span>
            <span class="genre-count">${formatVisibleTotalCount(visibleCount, totalCount)}</span>
          </li>
        `;
      }).join("")}
    </ul>
  `;

  const totalCategories = orderedKeys.length;
  const visibleCategories = orderedKeys.reduce((count, tKey) => count + ((visibleSongCountsCache.taxonomy[tKey] || 0) > 0 ? 1 : 0), 0);

  renderAccordionCell("#categories-cell", {
    key: "categories",
    title: "Categories",
    headerMetaHtml: `<span class="genre-count">${formatVisibleTotalCount(visibleCategories, totalCategories)}</span>`,
    bodyHtml: categoriesBodyHtml
  });

  d3.select("#toggle-all-categories").on("click", () => {
    toggleAllVisibility(taxonomyVisibility);
    refreshAllFilterToggleCheckboxes();
    syncOrganizedGroupCheckboxes();
    renderChartRankHeader();
    buildTable();
    rerenderCurrentPanel(false);
    updateStatusBar();
    syncToggleAllButtonLabels();
  });

  bindGenreClicks();
  updateContextColumn();
}

// Countries panel
function renderCountriesPanel() {
  const countryCounts = {};
  songs.forEach(s => (s.countryCode || []).forEach(c => { countryCounts[c] = (countryCounts[c] || 0) + 1; }));

  let sorted = Object.entries(countryCounts);
  if (countrySortMode === "az") sorted.sort((a,b) => a[0].localeCompare(b[0]));
  else if (countrySortMode === "za") sorted.sort((a,b) => b[0].localeCompare(a[0]));
  else if (countrySortMode === "popular") sorted.sort((a,b) => {
  const diff = b[1] - a[1];
  if (diff !== 0) return diff;
  return a[0].localeCompare(b[0]);
  });
  else if (countrySortMode === "unpopular") sorted.sort((a,b) => {
  const diff = a[1] - b[1];
  if (diff !== 0) return diff;
  return a[0].localeCompare(b[0]);
});

  const countriesBodyHtml = `
    <p class="panel-description">Filter the chart by artist country.</p>
    <div class="panel-controls-row">
      <button id="toggle-all-countries">${getToggleAllLabelFor(countryVisibility)}</button>
      ${renderSortDropdownHtml("countries", countrySortMode)}
    </div>
    <br>
    <ul>
      ${sorted.map(([c,totalCount]) => {
        const flagClass = getFlagIconClass(c);
        const visibleCount = visibleSongCountsCache.countries[c] || 0;
        return `
        <li>
          <input type="checkbox" class="country-toggle" data-country="${c}" ${countryVisibility[c] !== false ? "checked" : ""}>
          <span class="country-label">
            ${flagClass ? `<span class="country-flag ${flagClass}" aria-hidden="true"></span>` : ""}
            <span class="clickable-country" data-country="${c}">${c}</span>
          </span>
          <span class="genre-count">${formatVisibleTotalCount(visibleCount, totalCount)}</span>
        </li>`;
      }).join("")}
    </ul>
  `;

  const totalCountries = sorted.length;
  const visibleCountries = sorted.reduce((count, [c]) => count + ((visibleSongCountsCache.countries[c] || 0) > 0 ? 1 : 0), 0);

  renderAccordionCell("#countries-cell", {
    key: "countries",
    title: "Countries",
    headerMetaHtml: `<span class="genre-count">${formatVisibleTotalCount(visibleCountries, totalCountries)}</span>`,
    bodyHtml: countriesBodyHtml
  });

  updateContextColumn();
  // Toggle all countries
d3.select("#toggle-all-countries").on("click", () => {
  toggleAllVisibility(countryVisibility);
  refreshAllFilterToggleCheckboxes();
  renderChartRankHeader();
  buildTable();
  rerenderCurrentPanel(false);
  updateStatusBar();
  syncToggleAllButtonLabels();
});
  bindSortDropdown(
    "countries",
    () => countrySortMode,
    (mode) => { countrySortMode = mode; },
    renderCountriesPanel
  );

  bindGenreClicks();
}
// Artists panel 

function renderArtistsPanel() {
  const artistCounts = {};
  songs.forEach(s => (s.artists || []).forEach(a => { artistCounts[a] = (artistCounts[a] || 0) + 1; }));

  let sorted = Object.entries(artistCounts);
  if (artistSortMode === "az") sorted.sort((a,b) => a[0].localeCompare(b[0]));
  else if (artistSortMode === "za") sorted.sort((a,b) => b[0].localeCompare(a[0]));
  else if (artistSortMode === "popular") sorted.sort((a,b) => {
  const diff = b[1] - a[1];
  if (diff !== 0) return diff;
  return a[0].localeCompare(b[0]);
});

  else if (artistSortMode === "unpopular") sorted.sort((a,b) => {
  const diff = a[1] - b[1];
  if (diff !== 0) return diff;
  return a[0].localeCompare(b[0]);
});

  const artistsBodyHtml = `
    <p class="panel-description">Filter the chart by artists.</p>
    <div class="panel-controls-row">
      <button id="toggle-all-artists">${getToggleAllLabelFor(artistVisibility)}</button>
      ${renderSortDropdownHtml("artists", artistSortMode)}
    </div>
    <br>
    <ul>
      ${sorted.map(([a, totalCount]) => {
        const visibleCount = visibleSongCountsCache.artists[a] || 0;
        return `
        <li>
          <input type="checkbox" class="artist-toggle" data-artist="${a}" ${artistVisibility[a] !== false ? "checked" : ""}>
          <span class="clickable-artist" data-artist="${a}">${a}</span> <span class="genre-count">${formatVisibleTotalCount(visibleCount, totalCount)}</span>
        </li>`;
      }).join("")}
    </ul>
  `;

  const totalArtists = sorted.length;
  const visibleArtists = sorted.reduce((count, [a]) => count + ((visibleSongCountsCache.artists[a] || 0) > 0 ? 1 : 0), 0);

  renderAccordionCell("#artists-cell", {
    key: "artists",
    title: "Artists",
    headerMetaHtml: `<span class="genre-count">${formatVisibleTotalCount(visibleArtists, totalArtists)}</span>`,
    bodyHtml: artistsBodyHtml
  });

  updateContextColumn();
// Toggle all Artists

d3.select("#toggle-all-artists").on("click", () => {
  toggleAllVisibility(artistVisibility);
  refreshAllFilterToggleCheckboxes();
  renderChartRankHeader();
  buildTable();
  rerenderCurrentPanel(false);
  updateStatusBar();
  syncToggleAllButtonLabels();
});
  bindSortDropdown(
    "artists",
    () => artistSortMode,
    (mode) => { artistSortMode = mode; },
    renderArtistsPanel
  );

  bindGenreClicks();
}

// Ratings panel
function renderRatingsPanel() {
  const minRating = 0.5;
  const maxRating = 5;
  // Visual tick marks only (no snapping).
  const tickStep = 0.25;

  const clampToRange = (value) => {
    const v = Number(value);
    if (!Number.isFinite(v)) return minRating;
    return Math.min(maxRating, Math.max(minRating, v));
  };

  ratingMinFilter = clampToRange(ratingMinFilter);
  ratingMaxFilter = clampToRange(ratingMaxFilter);
  if (ratingMinFilter > ratingMaxFilter) ratingMinFilter = ratingMaxFilter;

  const formatLabel = (value) => {
    const v = Number(value);
    if (!Number.isFinite(v)) return "";
    if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v));
    return v.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  };

  const allTicks = [];
  for (let v = minRating; v <= maxRating + 1e-9; v += tickStep) {
    allTicks.push(Number(v.toFixed(2)));
  }

  const tickHtml = allTicks.map((v) => {
    const pct = ((v - minRating) / (maxRating - minRating)) * 100;
    return `<span class="rating-range-tick" style="left:${pct}%"></span>`;
  }).join("");

  const labels = [];
  for (let v = minRating; v <= maxRating + 1e-9; v += 0.5) {
    labels.push(Number(v.toFixed(2)));
  }

  const labelsHtml = labels.map((v) => {
    const pct = ((v - minRating) / (maxRating - minRating)) * 100;
    return `<span class="rating-range-label" style="left:${pct}%">${formatLabel(v)}</span>`;
  }).join("");

  const ratingsBodyHtml = `
    <p class="panel-description">Filter the chart by RYM rating (weighted average of available single/track ratings).</p>
    <div class="rating-range">
      <div class="rating-range-header">
        <span class="rating-range-value" id="rating-range-value"></span>
        <button type="button" id="rating-reset">Reset</button>
      </div>
      <div class="rating-range-slider" id="rating-range-slider">
        <div class="rating-range-track"></div>
        <div class="rating-range-highlight" id="rating-range-highlight"></div>
        <input type="range" id="rating-range-min" min="${minRating}" max="${maxRating}" step="any" value="${ratingMinFilter}">
        <input type="range" id="rating-range-max" min="${minRating}" max="${maxRating}" step="any" value="${ratingMaxFilter}">
        <div class="rating-range-ticks">${tickHtml}</div>
      </div>
      <div class="rating-range-labels">${labelsHtml}</div>
    </div>
  `;

  const rangeText = `${formatLabel(ratingMinFilter)}\u2013${formatLabel(ratingMaxFilter)}`;

  renderAccordionCell("#ratings-cell", {
    key: "ratings",
    title: "Ratings",
    headerMetaHtml: `<span class="genre-count">${rangeText}</span>`,
    bodyHtml: ratingsBodyHtml
  });

  updateContextColumn();

  const minInput = d3.select("#rating-range-min");
  const maxInput = d3.select("#rating-range-max");
  const valueEl = d3.select("#rating-range-value");
  const highlightEl = d3.select("#rating-range-highlight");
  const sliderEl = d3.select("#rating-range-slider");

  const syncUi = () => {
    const minVal = clampToRange(minInput.property("value"));
    const maxVal = clampToRange(maxInput.property("value"));
    const leftPct = ((minVal - minRating) / (maxRating - minRating)) * 100;
    const rightPct = 100 - ((maxVal - minRating) / (maxRating - minRating)) * 100;

    valueEl.text(`${formatLabel(minVal)} \u2192 ${formatLabel(maxVal)} stars`);
    highlightEl.style("left", `${leftPct}%`).style("right", `${rightPct}%`);

    // Keep the closest thumb above the other when crossing.
    const minNode = minInput.node();
    const maxNode = maxInput.node();
    if (minNode && maxNode) {
      if (minVal >= maxVal) {
        minNode.style.zIndex = "3";
        maxNode.style.zIndex = "2";
      } else {
        minNode.style.zIndex = "2";
        maxNode.style.zIndex = "3";
      }
    }
  };

  const applyRatingFilter = () => {
    renderChartRankHeader();
    buildTable();
    rerenderCurrentPanel(false);
    updateStatusBar();
    syncToggleAllButtonLabels();
  };

  const onMinInput = () => {
    const nextMin = clampToRange(minInput.property("value"));
    const currentMax = clampToRange(maxInput.property("value"));
    ratingMinFilter = Math.min(nextMin, currentMax);
    if (nextMin > currentMax) minInput.property("value", ratingMinFilter);
    syncUi();
  };

  const onMaxInput = () => {
    const currentMin = clampToRange(minInput.property("value"));
    const nextMax = clampToRange(maxInput.property("value"));
    ratingMaxFilter = Math.max(nextMax, currentMin);
    if (nextMax < currentMin) maxInput.property("value", ratingMaxFilter);
    syncUi();
  };

  minInput.on("input", onMinInput);
  maxInput.on("input", onMaxInput);
  // Apply immediately on release (no snapping).
  const applyOnRelease = () => {
    ratingMinFilter = clampToRange(minInput.property("value"));
    ratingMaxFilter = clampToRange(maxInput.property("value"));
    if (ratingMinFilter > ratingMaxFilter) ratingMinFilter = ratingMaxFilter;
    minInput.property("value", ratingMinFilter);
    maxInput.property("value", ratingMaxFilter);
    syncUi();
    applyRatingFilter();
  };

  minInput.on("change", applyOnRelease);
  maxInput.on("change", applyOnRelease);

  d3.select("#rating-reset").on("click", () => {
    ratingMinFilter = minRating;
    ratingMaxFilter = maxRating;
    minInput.property("value", ratingMinFilter);
    maxInput.property("value", ratingMaxFilter);
    syncUi();
    applyRatingFilter();
  });

  syncUi();
}


// About panel 

function renderAboutPanel() {
  const taxonomyBadgesHTML = Object.entries(taxonomy)
    .map(([key, info]) => `
      <div class="taxonomy-item" style="margin-top: 8px;">
        <span class="genre-badge clickable-taxonomy"
              data-taxonomy="${key}"
              style="${getTaxonomyBadgeStyle(info.color)}">
          ${info.label}
        </span>
      </div>
    `).join("");

  const aboutBodyHtml = `
      <br>
      <p>Genres of Australia is an interactive data visualisation of the top 10 singles on Australian charts for each year from 1954 to 2025.</p>
      <br>
      <p>The aim is to highlight the trends, popularity, and the diversity of genres that have shaped Australians’ favourite songs over the last 70 years.</p>
      <br>
      <br>
      <h2>How to Use</h2>
      <br>
      <p>Click the checkboxes above the chart to sort songs by chart position (#1 to #10) or by genre, grouping songs within the same categories.</p>
      <br>
      <p>Click any cell to view song details and its video.</p>
      <br>
      <p>Click any genre or genre category to see its description and related genres.</p>
      <br>
      <p>Select specific genres, countries, or artists to build your own custom visualisation.</p>
      <br>
      <br>
      <h2>Genre Categories</h2>
      <br>
      <p>Each of the 700+ songs has been assigned to one of six main genre categories:</p>
      <br>
      <div class="taxonomy-badges">${taxonomyBadgesHTML}</div>
      <br>
      <p>Assignment is based on the song’s subgenres, artist background, and influences, determined at my discretion.</p>
      <br>
      <br>
      <h2>Sub Genres</h2>
      <br>
      <p>Sub genres for each single are ordered left to right from most to least influential</p>
      <br>
      <br>
      <h2>Chart Data</h2>
      <br>
      <p>Data was sourced from The Kent Music Report (1954–1988) and ARIA (1988–2025):</p>
      <br>
      <p><a target="_blank"  href="https://www.aria.com.au/charts/2025/singles-chart">ARIA year end charts</a></p>
      <br>
      <p><a target="_blank"  href="https://australian-charts.com/search.asp?cat=s&search=">Australian Chart Archives</a></p>
      <br>
      <br>
      <h2>Genre Data</h2>
      <br>
      <p>Genre information and assignment are sourced from aggregate and user-voted websites:</p>
      <br>
      <p><a target="_blank"  href="https://rateyourmusic.com/genres/">Rate Your Music</a></p>
      <br>
      <p><a target="_blank"  href="https://www.discogs.com/">Discogs</a></p>
      <br>
      <br>
      <p>Designed and built by Levi Gartner. </p>
  `;

  renderAccordionCell("#about-cell", {
    key: "about",
    title: "About",
    bodyHtml: aboutBodyHtml
  });
  bindGenreClicks();
  updateContextColumn();
}


// Song modal
  function showSongModal(songIndex, side = "A", autoPlay = false, alignTileTop = false, resetContextScroll = false) {
    const song = currentSongList[songIndex];
    if (!song) return;

    if (resetContextScroll) {
      scrollLeftPanelToTop();
    }

    // Track selection and update outline
    selectedSongRef = song;
    selectedSongIndex = songIndex;
    const selectedCellNode = syncSelectedSongCellSelection();

    if (alignTileTop && selectedCellNode) {
      requestAnimationFrame(() => scrollSelectedTileToTop(selectedCellNode));
    }

    // Open context column if empty
    if (d3.select(".context-column").classed("empty")) {
      d3.select(".context-column").classed("empty", false);
    }

    // Mutliple releases
    let combinedTitle = song.tracks[0].title;
    if (song.tracks.length > 1 && song.tracks[1].title) {
      combinedTitle += " / " + song.tracks[1].title;
    }
    const hasSecondTrack = song.tracks.length > 1 && song.tracks[1].youtubeId;
    const hasSecondTitle = hasSecondTrack && !!song.tracks[1].title;

    const visibleSides = getVisibleSidesForSong(song);
    if (!hasSecondTrack) {
      selectedSongSide = "A";
    } else {
      const requested = String(side || "A").toUpperCase() === "B" ? "B" : "A";
      if (visibleSides.includes(requested)) selectedSongSide = requested;
      else if (visibleSides.includes("A")) selectedSongSide = "A";
      else selectedSongSide = "B";
    }
    const currentTrack = selectedSongSide === "B" ? song.tracks[1] : song.tracks[0];
    const selectedSideTitle = currentTrack?.title || combinedTitle;

    // Embed YouTube video. nocookie version
    const videoHtml = (track) => {
      const params = new URLSearchParams({
        enablejsapi: "1",
        playsinline: "1",
        rel: "0"
      });
      if (autoPlay) params.set("autoplay", "1");

      return `
      <div class="video-wrapper">
        <iframe
          id="current-video-player"
          src="https://www.youtube-nocookie.com/embed/${track.youtubeId}?${params.toString()}"
          frameborder="0"
          allow="autoplay; encrypted-media; picture-in-picture"
          allowfullscreen>
        </iframe>
      </div>
    `;
    };
    // Build clickable genre spans
    const sideGenres = getSongGenresForSide(song, selectedSongSide);
    const genreSpans = [sideGenres.primarygenre, ...(sideGenres.subgenres || [])]
      .filter(Boolean)
      .map(g => `<span class="clickable-genre" data-genre="${g}">${g}</span>`)
      .join(" • ");
    const descriptorSpans = getSongDescriptorsForSide(song, selectedSongSide)
      .filter(Boolean)
      .map(d => `<span class="clickable-descriptor" data-descriptor="${d}">${d}</span>`)
      .join(" • ");
    const descriptorsRowHtml = descriptorSpans ? `<p class="song-descriptors-row">${descriptorSpans}</p>` : "";

    // Build ratings row
    const ratings = getSongRatingsForSide(song, selectedSongSide);
    let ratingsRowHtml = "";
    if (ratings.primary || ratings.single || ratings.track) {
      const formatRating = (rating, label) => {
        if (!rating || typeof rating.score !== 'number' || typeof rating.votes !== 'number' || rating.votes <= 0) {
          return `${label}: no data`;
        }
        return `${label}: ${rating.score.toFixed(2)}/5 from ${rating.votes} rating${rating.votes > 1 ? 's' : ''}`;
      };

      const primaryText = ratings.primary ? `RYM rating ${ratings.primary.score.toFixed(2)}/5 from ${ratings.primary.votes} rating${ratings.primary.votes > 1 ? 's' : ''}` : 'RYM rating: no data';
      const singleText = formatRating(ratings.single, 'single rating');
      const trackText = formatRating(ratings.track, 'track rating');

      ratingsRowHtml = `<p class="song-ratings-row"><span class="primary-rating">${primaryText}</span><br><span class="secondary-ratings">${singleText}, ${trackText}</span></p>`;
    }

    const artistCountryPairsHtml = getArtistsForSide(song, selectedSongSide)
      .map(({ artist, country }) => {
        const flagClass = country ? getFlagIconClass(country) : "";
        const flagHtml = flagClass
          ? `<span class="country-flag ${flagClass} clickable-country" data-country="${country}" title="${country}" aria-label="${country}" role="img"></span>`
          : "";

        return `<span class="artist-country-pair"><span class="artist-name clickable-artist" data-artist="${artist}">${artist}</span>${flagHtml}</span>`;
      })
      .join(getSongArtistSeparator(song));
    // Peak chart info
    let peakInfo = "";
    if (song.peakPos) {
      peakInfo = `Peaked at #${song.peakPos}`;
      if (song.weeksOnChart) {
        peakInfo += ` for ${song.weeksOnChart} week${song.weeksOnChart > 1 ? "s" : ""}`;
      }
    }
    const chartInfoParts = [`Rank #${song.rank} for ${song.chartYear}`];
    if (peakInfo) chartInfoParts.push(peakInfo);
    chartInfoParts.push(`Released ${song.releaseYear}`);
    const chartInfoText = chartInfoParts.join("  •  ");

    const currentSideOrVersionLabel = hasSecondTitle
      ? (selectedSongSide === "A" ? "A Side" : "B Side")
      : (selectedSongSide === "A" ? "Ver 1" : "Ver 2");

    const tax = taxonomy[song.genretaxonomy];
    // Fill modal cell content
    const songBodyHtml = `
      <div id="video-container">${videoHtml(currentTrack)}</div>
      <div class="song-body-content">
        <h1 class="song-selected-title"><span class="song-selected-title-text">${selectedSideTitle}</span></h1>
        <div class="song-gap-half" aria-hidden="true"></div>
        <p class="song-artists-line"><span class="artists artists-with-flags">${artistCountryPairsHtml}</span></p>
        <div class="song-gap-full" aria-hidden="true"></div>
        <p class="song-chart-info-line">${chartInfoText}</p>
        <div class="song-gap-full" aria-hidden="true"></div>
        <div class="song-taxonomy-row">${tax ? `<div class="genre-badge clickable-taxonomy" style="${getTaxonomyBadgeStyle(tax.color)}" data-taxonomy="${song.genretaxonomy}">${tax.label}</div>` : ""}</div>
        <div class="song-gap-full" aria-hidden="true"></div>
        <p class="song-genres-row">${genreSpans}</p>
        ${descriptorsRowHtml}
        ${descriptorsRowHtml ? '<div class="song-gap-full" aria-hidden="true"></div>' : ''}
        ${ratingsRowHtml}
      </div>
    `;

    const songSummaryHtml = `
      <div class="song-compact-meta">
        <span class="song-compact-title">${selectedSideTitle}</span>
        <span class="song-compact-artist">${getArtistsForSide(song, selectedSongSide).map(d => d.artist).join(getSongArtistSeparator(song))}</span>
      </div>
      <div class="song-compact-controls">
        ${(hasSecondTrack && visibleSides.length === 2) ? `<button id="compact-toggle-side" title="Toggle side">${currentSideOrVersionLabel}</button>` : ""}
        <div class="song-compact-transport">
          <button id="compact-prev-song" title="Previous song" aria-label="Previous song"><span class="play-icon">${getStepButtonIconSvg("prev")}</span></button>
          <button id="compact-play" title="Play video" aria-label="Play video"><span class="play-icon">${getPlayButtonIconSvg(false)}</span></button>
          <button id="compact-next-song" title="Next song" aria-label="Next song"><span class="play-icon">${getStepButtonIconSvg("next")}</span></button>
        </div>
      </div>
    `;

    d3.select("#song-modal-cell").style("display", "block");
    renderAccordionCell("#song-modal-cell", {
      key: "song",
      title: "",
      summaryHtml: songSummaryHtml,
      bodyHtml: songBodyHtml,
      defaultOpen: true,
      headerBorderColor: tax?.color || ""
    });
    ensureYouTubeMessageListener();
    registerCurrentYouTubePlayer();

    const currentIframe = getCurrentVideoIframe();
    if (currentIframe) {
      currentIframe.addEventListener("load", registerCurrentYouTubePlayer, { once: true });
    }

    fitOpenSongTitle();

    setCurrentVideoPlaying(!!autoPlay);

    bindGenreClicks();

    d3.selectAll(".clickable-genre").on("click", function() {
      const gKey = d3.select(this).attr("data-genre");
      closeSongAccordion();
      showGenrePanel(gKey, true);
    });

    // Keep modal navigation behavior in sync with chart controls.
    function movePrevSong() {
      showRelativeVisibleSong(-1);
    }

    function moveNextSong() {
      showRelativeVisibleSong(1);
    }

    function toggleSongSide() {
      if (!hasSecondTrack) return;
      const nextSide = selectedSongSide === "A" ? "B" : "A";
      showSongModal(songIndex, nextSide);
    }

    d3.select("#compact-prev-song").on("click", function(event) {
      event.stopPropagation();
      movePrevSong();
    });
    d3.select("#compact-next-song").on("click", function(event) {
      event.stopPropagation();
      moveNextSong();
    });

    if (hasSecondTrack && visibleSides.length === 2) {
      d3.select("#compact-toggle-side").on("click", function(event) {
        event.stopPropagation();
        toggleSongSide();
      });
    }

    d3.select("#compact-play").on("click", function(event) {
      event.stopPropagation();
      toggleCurrentVideoPlayback();
    });

    // no overlay needed; using context cell
  }

//organised genre list

function renderFeaturedGenresList() {
  const getGenreLabel = (key, info) => {
    if (info && typeof info.label === "string" && info.label.trim().length > 0) {
      return info.label;
    }
    return key;
  };

  const grouped = {};

  Object.entries(genres).forEach(([gKey, g]) => {
    const groups = Array.isArray(g.genreGroup) ? g.genreGroup : [g.genreGroup];
    groups.forEach(group => {
      if (!group) return;
      if (!grouped[group]) grouped[group] = [];
      grouped[group].push([gKey, g]);
    });
  });

  const sortedGroups = Object.keys(grouped).sort((a, b) => a.localeCompare(b));

  return sortedGroups.map(group => {
    if (organizedGroupState[group] === undefined) organizedGroupState[group] = false;
    const isOpen = organizedGroupState[group];

    const groupGenreKeys = grouped[group].map(([gKey]) => gKey);
    const groupCheckedCount = groupGenreKeys.reduce((count, gKey) => count + (genreVisibility[gKey] !== false ? 1 : 0), 0);
    const groupAllChecked = groupGenreKeys.length > 0 && groupCheckedCount === groupGenreKeys.length;
    const groupItemCountTotal = groupGenreKeys.length;
    const groupItemCountVisible = groupGenreKeys.reduce((count, gKey) => count + ((visibleSongCountsCache.genres[gKey] || 0) > 0 ? 1 : 0), 0);

    const groupGenres = grouped[group]
      .sort((a, b) => {
        const [aKey, aInfo] = a;
        const [bKey, bInfo] = b;
        const aLabel = getGenreLabel(aKey, aInfo);
        const bLabel = getGenreLabel(bKey, bInfo);
        return aLabel.localeCompare(bLabel);
      })
      .map(([gKey, g]) => {
        const totalCount = genreCounts[gKey] || 0; // show how many songs that genre has
        const visibleCount = visibleSongCountsCache.genres[gKey] || 0;
        return `
          <li class="genre-item" style="display:flex; align-items:center; gap:6px; margin:4px 0;">
            <input type="checkbox" class="genre-toggle" data-genre="${gKey}" ${genreVisibility[gKey] !== false ? "checked" : ""}>
            <span class="clickable-genre" data-genre="${gKey}">
              ${getGenreLabel(gKey, g)}
            </span>
            <span class="genre-count">${formatVisibleTotalCount(visibleCount, totalCount)}</span>
          </li>`;
      }).join("");

    return `
      <div class="organized-group ${isOpen ? "is-open" : "is-closed"}" data-organized-group="${group}" data-organized-group-genres="${groupGenreKeys.join("|")}">
        <div class="organized-group-toggle" data-organized-group="${group}" role="button" tabindex="0" aria-expanded="${isOpen ? "true" : "false"}">
          <input type="checkbox" class="organized-group-checkbox" data-organized-group="${group}" aria-label="Toggle all genres in ${group}" ${groupAllChecked ? "checked" : ""}>
          <span class="organized-group-title">${group}</span>
          <span class="organized-group-count">${formatVisibleTotalCount(groupItemCountVisible, groupItemCountTotal)}</span>
          <span class="organized-group-arrow">&#x203A;</span>
        </div>
        <div class="organized-group-body">
          <ul>${groupGenres}</ul>
        </div>
      </div>
    `;
  }).join("");
}


function syncOrganizedGroupCheckboxes() {
  d3.selectAll(".organized-group").each(function() {
    const container = d3.select(this);
    const keysAttr = container.attr("data-organized-group-genres") || "";
    const groupGenreKeys = keysAttr.split("|").map(v => v.trim()).filter(Boolean);
    if (groupGenreKeys.length === 0) return;

    const checkboxNode = container.select(".organized-group-checkbox").node();
    if (!checkboxNode) return;

    const checkedCount = groupGenreKeys.reduce((count, gKey) => count + (genreVisibility[gKey] !== false ? 1 : 0), 0);
    const anyChecked = checkedCount > 0;
    const allChecked = checkedCount === groupGenreKeys.length;

    checkboxNode.checked = allChecked;
    checkboxNode.indeterminate = anyChecked && !allChecked;
  });
}

  
function renderAllGenresList() {
  let sorted = [...allGenresList];

  if (genreSortMode === "az") {
    sorted.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  } else if (genreSortMode === "za") {
    sorted.sort((a, b) => b.toLowerCase().localeCompare(a.toLowerCase()));
  } else if (genreSortMode === "popular") {
    sorted.sort((a, b) => {
      const visibleA = mustContainAllSelectedGenres ? (visibleSongCountsCache.genres[a] || 0) : (genreCounts[a] || 0);
      const visibleB = mustContainAllSelectedGenres ? (visibleSongCountsCache.genres[b] || 0) : (genreCounts[b] || 0);
      const diffVisible = visibleB - visibleA;
      if (diffVisible !== 0) return diffVisible; // primary: visible popularity

      if (mustContainAllSelectedGenres) {
        const totalA = genreCounts[a] || 0;
        const totalB = genreCounts[b] || 0;
        const diffTotal = totalB - totalA;
        if (diffTotal !== 0) return diffTotal; // secondary: total popularity
      }

      return a.toLowerCase().localeCompare(b.toLowerCase()); // tertiary: A-Z
    });
  } else if (genreSortMode === "unpopular") {
    sorted.sort((a, b) => {
      const countA = mustContainAllSelectedGenres ? (visibleSongCountsCache.genres[a] || 0) : (genreCounts[a] || 0);
      const countB = mustContainAllSelectedGenres ? (visibleSongCountsCache.genres[b] || 0) : (genreCounts[b] || 0);

      const diff = countA - countB;
      if (diff !== 0) return diff; // primary: least popular

      if (mustContainAllSelectedGenres) {
        const totalA = genreCounts[a] || 0;
        const totalB = genreCounts[b] || 0;
        // For ties in visible counts, keep overall-most higher.
        const diffTotal = totalB - totalA;
        if (diffTotal !== 0) return diffTotal;
      }

      return a.toLowerCase().localeCompare(b.toLowerCase()); // tertiary: A-Z
    });
  }

  return sorted.map(gKey => {
    const manual = genres[gKey];
    const totalCount = genreCounts[gKey] || 0;
    const visibleCount = visibleSongCountsCache.genres[gKey] || 0;
    return `<li>
      <input type="checkbox" class="genre-toggle" data-genre="${gKey}" ${genreVisibility[gKey] !== false ? "checked" : ""}>
      <span class="clickable-genre" data-genre="${gKey}">${manual ? manual.label : gKey}</span>
      <span class="genre-count">${formatVisibleTotalCount(visibleCount, totalCount)}</span>
    </li>`;
  }).join("");
}

function renderGenreListCell() {
  const allGenresChecked = Object.values(genreVisibility).every(v => v) &&
                           Object.values(taxonomyVisibility).every(v => v);
  const toggleAllLabel = allGenresChecked ? "Hide all" : "Show all";
  const listHTML = genreListView === "all" ? renderAllGenresList() : renderFeaturedGenresList();
  const listContainer = genreListView === "all"
    ? `<ul>${listHTML}</ul>`
    : `<div class="organized-groups">${listHTML}</div>`;
  const viewButtonHtml = renderGenreViewDropdownHtml(genreListView);
  const sortButtonHtml = genreListView === "all"
    ? renderSortDropdownHtml("genres", genreSortMode)
    : "";
  const genresDescription = genreListView === "all"
    ? "Browse all genres in the database."
    : "Browse grouped and organised genres.";

  const mustContainAllGenresRowHtml = `
    <div class="panel-controls-row panel-controls-row--checkbox">
      <label class="must-contain-all-toggle">
        <input type="checkbox" id="genres-must-contain-all" ${mustContainAllSelectedGenres ? "checked" : ""}>
        <span>Must contain all selected genres</span>
      </label>
    </div>
  `;

  const genresBodyHtml = `
     <p class="panel-description">${genresDescription}</p>
     <div class="panel-controls-row">${viewButtonHtml}
       <button id="toggle-all-genres">${toggleAllLabel}</button>
       ${sortButtonHtml}
     </div>
     ${mustContainAllGenresRowHtml}
    <br>
     ${listContainer}
  `;

  const totalGenres = allGenresList.length;
  const visibleGenres = allGenresList.reduce((count, gKey) => count + ((visibleSongCountsCache.genres[gKey] || 0) > 0 ? 1 : 0), 0);

  renderAccordionCell("#genres-cell", {
    key: "genres",
    title: "Genres",
    headerMetaHtml: `<span class="genre-count">${formatVisibleTotalCount(visibleGenres, totalGenres)}</span>`,
    bodyHtml: genresBodyHtml
  });
  bindGenreViewDropdown();

  d3.select("#genres-must-contain-all").on("change", function() {
    mustContainAllSelectedGenres = !!this.checked;
    buildTable();
  });

  function setOrganizedGroupState(container, nowOpen, immediate = false) {
    const bodyNode = container.select(".organized-group-body").node();
    if (!bodyNode) return;

    container.classed("is-open", nowOpen).classed("is-closed", !nowOpen);
    container.select(".organized-group-toggle").attr("aria-expanded", nowOpen ? "true" : "false");

    if (immediate) {
      bodyNode.style.display = nowOpen ? "block" : "none";
      bodyNode.style.maxHeight = nowOpen ? "none" : "0px";
      bodyNode.style.opacity = nowOpen ? "1" : "0";
      bodyNode.style.paddingTop = nowOpen ? "6px" : "0px";
      return;
    }

    if (nowOpen) {
      bodyNode.style.display = "block";
      bodyNode.style.maxHeight = "0px";
      bodyNode.style.opacity = "0";
      bodyNode.style.paddingTop = "0px";
      requestAnimationFrame(() => {
        bodyNode.style.maxHeight = `${bodyNode.scrollHeight}px`;
        bodyNode.style.opacity = "1";
        bodyNode.style.paddingTop = "6px";
      });
      const onOpenEnd = (event) => {
        if (event.propertyName !== "max-height") return;
        bodyNode.style.maxHeight = "none";
        bodyNode.removeEventListener("transitionend", onOpenEnd);
      };
      bodyNode.addEventListener("transitionend", onOpenEnd);
    } else {
      const currentHeight = bodyNode.scrollHeight;
      bodyNode.style.maxHeight = `${currentHeight}px`;
      bodyNode.style.opacity = "1";
      bodyNode.style.paddingTop = "6px";
      requestAnimationFrame(() => {
        bodyNode.style.maxHeight = "0px";
        bodyNode.style.opacity = "0";
        bodyNode.style.paddingTop = "0px";
      });
      const onCloseEnd = (event) => {
        if (event.propertyName !== "max-height") return;
        bodyNode.style.display = "none";
        bodyNode.removeEventListener("transitionend", onCloseEnd);
      };
      bodyNode.addEventListener("transitionend", onCloseEnd);
    }
  }

  d3.selectAll(".organized-group").each(function() {
    const container = d3.select(this);
    const group = container.attr("data-organized-group");
    setOrganizedGroupState(container, !!organizedGroupState[group], true);
  });

  d3.selectAll(".organized-group-toggle").on("click", function(event) {
    // Ignore clicks on the group checkbox (it has its own handler).
    if (event && (event.target?.closest?.(".organized-group-checkbox"))) return;
    const group = d3.select(this).attr("data-organized-group");
    organizedGroupState[group] = !organizedGroupState[group];
    const container = d3.select(this.closest(".organized-group"));
    setOrganizedGroupState(container, organizedGroupState[group]);
  });

  d3.selectAll(".organized-group-toggle").on("keydown", function(event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    const group = d3.select(this).attr("data-organized-group");
    organizedGroupState[group] = !organizedGroupState[group];
    const container = d3.select(this.closest(".organized-group"));
    setOrganizedGroupState(container, organizedGroupState[group]);
  });

  d3.selectAll(".organized-group-checkbox")
    .on("click", function(event) {
      event.stopPropagation();
    })
    .on("change", function(event) {
      event.stopPropagation();
      const container = d3.select(this.closest(".organized-group"));
      const keysAttr = container.attr("data-organized-group-genres") || "";
      const groupGenreKeys = keysAttr.split("|").map(v => v.trim()).filter(Boolean);
      const newState = !!this.checked;

      groupGenreKeys.forEach((gKey) => {
        genreVisibility[gKey] = newState;
        d3.selectAll(`.genre-toggle[data-genre="${gKey}"]`).property("checked", newState);
      });

      invalidateSelectedFilterKeysCache();
      buildTable();
      rerenderCurrentPanel(false);
      syncOrganizedGroupCheckboxes();
    });

  syncOrganizedGroupCheckboxes();
  
  bindGenreClicks();
  updateContextColumn();
  d3.select("#toggle-all-genres").on("click", function() {
      toggleAllGenreVisibility();
      mustContainAllSelectedGenres = false;
      d3.select("#genres-must-contain-all").property("checked", false);
      refreshAllFilterToggleCheckboxes();
      syncOrganizedGroupCheckboxes();
      renderChartRankHeader();
      buildTable();
      rerenderCurrentPanel(false);
      updateStatusBar();
      syncToggleAllButtonLabels();
  });
  const sortGenresBtn = d3.select("#sort-genres-btn");
  if (!sortGenresBtn.empty()) {
    bindSortDropdown(
      "genres",
      () => genreSortMode,
      (mode) => { genreSortMode = mode; },
      renderGenreListCell
    );
  }
}

// Organised descriptor list
function renderFeaturedDescriptorsList() {
  const visibleSongs = getVisibleSongs();
  const songDescriptorSetCache = new WeakMap();

  const getSongDescriptorSet = (song) => {
    if (songDescriptorSetCache.has(song)) return songDescriptorSetCache.get(song);
    const set = new Set(getAllSongDescriptors(song).map(d => String(d || "").toLowerCase()));
    songDescriptorSetCache.set(song, set);
    return set;
  };

  const songHasAnyDescriptor = (song, descriptorKeys) => {
    if (!song || !descriptorKeys || descriptorKeys.length === 0) return false;
    const descriptorSet = getSongDescriptorSet(song);
    return descriptorKeys.some((dKey) => descriptorSet.has(String(dKey || "").toLowerCase()));
  };

  const getDescriptorLabel = (key, info) => {
    if (info && typeof info.label === "string" && info.label.trim().length > 0) return info.label;
    return key;
  };

  const grouped = {};
  const ungroupedDescriptors = [];

  allDescriptorsList.forEach((dKey) => {
    const meta = descriptors[dKey];

    const groups = Array.isArray(meta?.descriptorGroup)
      ? meta.descriptorGroup
      : (meta?.descriptorGroup ? [meta.descriptorGroup] : []);
    const resolvedGroups = groups.map(g => String(g || "").trim()).filter(Boolean);

    const subgroups = Array.isArray(meta?.descriptorSubgroup)
      ? meta.descriptorSubgroup
      : (meta?.descriptorSubgroup ? [meta.descriptorSubgroup] : []);
    const resolvedSubgroups = subgroups.map(sg => String(sg || "").trim()).filter(Boolean);

    // If there's no group, list the descriptor at the top level (no "Other" bucket).
    if (resolvedGroups.length === 0) {
      ungroupedDescriptors.push([dKey, meta]);
      return;
    }

    resolvedGroups.forEach((group) => {
      if (!grouped[group]) grouped[group] = { __ungrouped: [], __subgroups: {} };

      // If no subgroup, list directly under the group (no "Other" subgroup).
      if (resolvedSubgroups.length === 0) {
        grouped[group].__ungrouped.push([dKey, meta]);
        return;
      }

      resolvedSubgroups.forEach((subgroup) => {
        if (!grouped[group].__subgroups[subgroup]) grouped[group].__subgroups[subgroup] = [];
        grouped[group].__subgroups[subgroup].push([dKey, meta]);
      });
    });
  });

  const sortedGroups = Object.keys(grouped).sort((a, b) => a.localeCompare(b));

  const renderDescriptorItemsHtml = (items) => {
    const list = Array.isArray(items) ? items.slice() : [];
    return list
      .sort((a, b) => {
        const [aKey, aInfo] = a;
        const [bKey, bInfo] = b;
        const aLabel = getDescriptorLabel(aKey, aInfo);
        const bLabel = getDescriptorLabel(bKey, bInfo);
        return aLabel.localeCompare(bLabel);
      })
      .map(([dKey, d]) => {
        const totalCount = descriptorCounts[dKey] || 0;
        const visibleCount = visibleSongCountsCache.descriptors[dKey] || 0;
        return `
          <li class="descriptor-item" style="display:flex; align-items:center; gap:6px; margin:4px 0;">
            <input type="checkbox" class="descriptor-toggle" data-descriptor="${dKey}" ${descriptorVisibility[dKey] !== false ? "checked" : ""}>
            <span class="clickable-descriptor" data-descriptor="${dKey}">
              ${getDescriptorLabel(dKey, d)}
            </span>
            <span class="genre-count">${formatVisibleTotalCount(visibleCount, totalCount)}</span>
          </li>`;
      })
      .join("");
  };

  const groupedHtml = sortedGroups.map(group => {
    if (organizedDescriptorGroupState[group] === undefined) organizedDescriptorGroupState[group] = false;
    const isOpen = organizedDescriptorGroupState[group];

    const groupBucket = grouped[group] || { __ungrouped: [], __subgroups: {} };
    const groupUngroupedItems = groupBucket.__ungrouped || [];
    const subgroups = groupBucket.__subgroups || {};

    // Create combined list of descriptors and subgroups, sorted alphabetically
    const combinedItems = [];

    // Add ungrouped descriptors
    groupUngroupedItems.forEach(([dKey, meta]) => {
      const label = getDescriptorLabel(dKey, meta);
      combinedItems.push({ type: 'descriptor', name: label, data: [dKey, meta] });
    });

    // Add subgroups
    Object.keys(subgroups).forEach(subgroupName => {
      combinedItems.push({ type: 'subgroup', name: subgroupName, data: subgroups[subgroupName] });
    });

    // Sort combined items alphabetically by name
    combinedItems.sort((a, b) => a.name.localeCompare(b.name));

    const groupDescriptorKeys = Array.from(new Set([
      ...groupUngroupedItems.map(([dKey]) => dKey),
      ...Object.keys(subgroups).flatMap((name) => (subgroups[name] || []).map(([dKey]) => dKey))
    ]));

    const groupItemCountTotal = groupDescriptorKeys.length;
    const groupItemCountVisible = groupDescriptorKeys.reduce(
      (count, dKey) => count + ((visibleSongCountsCache.descriptors[dKey] || 0) > 0 ? 1 : 0),
      0
    );

    const combinedHtml = combinedItems.map(item => {
      if (item.type === 'descriptor') {
        const [dKey, d] = item.data;
        const totalCount = descriptorCounts[dKey] || 0;
        const visibleCount = visibleSongCountsCache.descriptors[dKey] || 0;
        return `
          <ul>
            <li class="descriptor-item" style="display:flex; align-items:center; gap:6px; margin:4px 0;">
              <input type="checkbox" class="descriptor-toggle" data-descriptor="${dKey}" ${descriptorVisibility[dKey] !== false ? "checked" : ""}>
              <span class="clickable-descriptor" data-descriptor="${dKey}">
                ${item.name}
              </span>
              <span class="genre-count">${formatVisibleTotalCount(visibleCount, totalCount)}</span>
            </li>
          </ul>`;
      } else if (item.type === 'subgroup') {
        const subgroupName = item.name;
        const items = item.data;
        const subgroupKey = `${group}::${subgroupName}`;
        if (organizedDescriptorSubgroupState[subgroupKey] === undefined) organizedDescriptorSubgroupState[subgroupKey] = false;
        const isSubOpen = organizedDescriptorSubgroupState[subgroupKey];

        const subgroupDescriptorKeys = items.map(([dKey]) => dKey);
        const subgroupCheckedCount = subgroupDescriptorKeys.reduce((count, dKey) => count + (descriptorVisibility[dKey] !== false ? 1 : 0), 0);
        const subgroupAllChecked = subgroupDescriptorKeys.length > 0 && subgroupCheckedCount === subgroupDescriptorKeys.length;

        const subgroupItemCountTotal = songs.reduce((count, song) => count + (songHasAnyDescriptor(song, subgroupDescriptorKeys) ? 1 : 0), 0);
        const subgroupItemCountVisible = visibleSongs.reduce((count, song) => count + (songHasAnyDescriptor(song, subgroupDescriptorKeys) ? 1 : 0), 0);

        const descriptorListHtml = renderDescriptorItemsHtml(items);

        return `
          <div class="organized-descriptor-subgroup ${isSubOpen ? "is-open" : "is-closed"}"
               data-organized-descriptor-subgroup="${subgroupName}"
               data-organized-descriptor-subgroup-parent="${group}"
               data-organized-descriptor-subgroup-keys="${subgroupDescriptorKeys.join("|")}">
            <div class="organized-descriptor-subgroup-toggle"
                 data-organized-descriptor-subgroup="${subgroupName}"
                 data-organized-descriptor-subgroup-parent="${group}"
                 role="button"
                 tabindex="0"
                 aria-expanded="${isSubOpen ? "true" : "false"}">
              <input type="checkbox"
                     class="organized-descriptor-subgroup-checkbox"
                     data-organized-descriptor-subgroup="${subgroupName}"
                     data-organized-descriptor-subgroup-parent="${group}"
                     aria-label="Toggle all descriptors in ${subgroupName}"
                     ${subgroupAllChecked ? "checked" : ""}>
              <span class="organized-descriptor-subgroup-title">${subgroupName}</span>
              <span class="organized-descriptor-subgroup-count">${formatVisibleTotalCount(subgroupItemCountVisible, subgroupItemCountTotal)}</span>
              <span class="organized-descriptor-subgroup-arrow">&#x203A;</span>
            </div>
            <div class="organized-descriptor-subgroup-body">
              <ul>${descriptorListHtml}</ul>
            </div>
          </div>
        `;
      }
    }).join("");

    return `
      <div class="organized-descriptor-group ${isOpen ? "is-open" : "is-closed"}" data-organized-descriptor-group="${group}" data-organized-descriptor-group-keys="${groupDescriptorKeys.join("|")}">
        <div class="organized-descriptor-group-toggle" data-organized-descriptor-group="${group}" role="button" tabindex="0" aria-expanded="${isOpen ? "true" : "false"}">
          <span class="organized-descriptor-group-title">${group}</span>
          <span class="organized-descriptor-group-count">${formatVisibleTotalCount(groupItemCountVisible, groupItemCountTotal)}</span>
          <span class="organized-descriptor-group-arrow">&#x203A;</span>
        </div>
        <div class="organized-descriptor-group-body">
          <div class="organized-descriptor-group-items">
            ${combinedHtml}
          </div>
        </div>
      </div>
    `;
  }).join("");

  const ungroupedHtml = ungroupedDescriptors.length
    ? `<div class="organized-descriptor-ungrouped"><ul>${renderDescriptorItemsHtml(ungroupedDescriptors)}</ul></div>`
    : "";

  return `${ungroupedHtml}${groupedHtml}`;
}

function syncOrganizedDescriptorGroupCheckboxes() {
  d3.selectAll(".organized-descriptor-group").each(function() {
    const container = d3.select(this);
    const keysAttr = container.attr("data-organized-descriptor-group-keys") || "";
    const groupDescriptorKeys = keysAttr.split("|").map(v => v.trim()).filter(Boolean);
    if (groupDescriptorKeys.length === 0) return;

    const checkboxNode = container.select(".organized-descriptor-group-checkbox").node();
    if (!checkboxNode) return;

    const checkedCount = groupDescriptorKeys.reduce((count, dKey) => count + (descriptorVisibility[dKey] !== false ? 1 : 0), 0);
    const anyChecked = checkedCount > 0;
    const allChecked = checkedCount === groupDescriptorKeys.length;

    checkboxNode.checked = allChecked;
    checkboxNode.indeterminate = anyChecked && !allChecked;
  });
}

function syncOrganizedDescriptorSubgroupCheckboxes() {
  d3.selectAll(".organized-descriptor-subgroup").each(function() {
    const container = d3.select(this);
    const keysAttr = container.attr("data-organized-descriptor-subgroup-keys") || "";
    const subgroupDescriptorKeys = keysAttr.split("|").map(v => v.trim()).filter(Boolean);
    if (subgroupDescriptorKeys.length === 0) return;

    const checkboxNode = container.select(".organized-descriptor-subgroup-checkbox").node();
    if (!checkboxNode) return;

    const checkedCount = subgroupDescriptorKeys.reduce((count, dKey) => count + (descriptorVisibility[dKey] !== false ? 1 : 0), 0);
    const anyChecked = checkedCount > 0;
    const allChecked = checkedCount === subgroupDescriptorKeys.length;

    checkboxNode.checked = allChecked;
    checkboxNode.indeterminate = anyChecked && !allChecked;
  });
}

function renderAllDescriptorsList() {
  const getLabel = (key) => {
    const meta = descriptors[key];
    if (meta && typeof meta.label === "string" && meta.label.trim().length > 0) return meta.label;
    return key;
  };

  let sorted = [...allDescriptorsList];

  if (descriptorSortMode === "az") {
    sorted.sort((a, b) => getLabel(a).toLowerCase().localeCompare(getLabel(b).toLowerCase()));
  } else if (descriptorSortMode === "za") {
    sorted.sort((a, b) => getLabel(b).toLowerCase().localeCompare(getLabel(a).toLowerCase()));
  } else if (descriptorSortMode === "popular") {
    sorted.sort((a, b) => {
      const visibleA = mustContainAllSelectedDescriptors ? (visibleSongCountsCache.descriptors[a] || 0) : (descriptorCounts[a] || 0);
      const visibleB = mustContainAllSelectedDescriptors ? (visibleSongCountsCache.descriptors[b] || 0) : (descriptorCounts[b] || 0);
      const diffVisible = visibleB - visibleA;
      if (diffVisible !== 0) return diffVisible;

      if (mustContainAllSelectedDescriptors) {
        const totalA = descriptorCounts[a] || 0;
        const totalB = descriptorCounts[b] || 0;
        const diffTotal = totalB - totalA;
        if (diffTotal !== 0) return diffTotal;
      }

      return getLabel(a).toLowerCase().localeCompare(getLabel(b).toLowerCase());
    });
  } else if (descriptorSortMode === "unpopular") {
    sorted.sort((a, b) => {
      const countA = mustContainAllSelectedDescriptors ? (visibleSongCountsCache.descriptors[a] || 0) : (descriptorCounts[a] || 0);
      const countB = mustContainAllSelectedDescriptors ? (visibleSongCountsCache.descriptors[b] || 0) : (descriptorCounts[b] || 0);

      const diff = countA - countB;
      if (diff !== 0) return diff;

      if (mustContainAllSelectedDescriptors) {
        const totalA = descriptorCounts[a] || 0;
        const totalB = descriptorCounts[b] || 0;
        const diffTotal = totalB - totalA;
        if (diffTotal !== 0) return diffTotal;
      }

      return getLabel(a).toLowerCase().localeCompare(getLabel(b).toLowerCase());
    });
  }

  return sorted.map(dKey => {
    const meta = descriptors[dKey];
    const totalCount = descriptorCounts[dKey] || 0;
    const visibleCount = visibleSongCountsCache.descriptors[dKey] || 0;
    return `<li>
      <input type="checkbox" class="descriptor-toggle" data-descriptor="${dKey}" ${descriptorVisibility[dKey] !== false ? "checked" : ""}>
      <span class="clickable-descriptor" data-descriptor="${dKey}">${meta ? meta.label : dKey}</span>
      <span class="genre-count">${formatVisibleTotalCount(visibleCount, totalCount)}</span>
    </li>`;
  }).join("");
}

function renderDescriptorsListCell() {
  const allDescriptorsChecked = Object.values(descriptorVisibility).every(v => v);
  const toggleAllLabel = allDescriptorsChecked ? "Hide all" : "Show all";

  const listHTML = descriptorListView === "all" ? renderAllDescriptorsList() : renderFeaturedDescriptorsList();
  const listContainer = descriptorListView === "all"
    ? `<ul>${listHTML}</ul>`
    : `<div class="organized-descriptor-groups">${listHTML}</div>`;

  const viewButtonHtml = renderDescriptorViewDropdownHtml(descriptorListView);
  const sortButtonHtml = descriptorListView === "all"
    ? renderSortDropdownHtml("descriptors", descriptorSortMode)
    : "";

  const descriptorsDescription = descriptorListView === "all"
    ? "Browse all descriptors in the database."
    : "Browse descriptors grouped by type.";

  const mustContainAllDescriptorsRowHtml = `
    <div class="panel-controls-row panel-controls-row--checkbox">
      <label class="must-contain-all-toggle">
        <input type="checkbox" id="descriptors-must-contain-all" ${mustContainAllSelectedDescriptors ? "checked" : ""}>
        <span>Must contain all selected descriptors</span>
      </label>
    </div>
  `;

  const descriptorsBodyHtml = `
     <p class="panel-description">${descriptorsDescription}</p>
     <div class="panel-controls-row">${viewButtonHtml}
       <button id="toggle-all-descriptors">${toggleAllLabel}</button>
       ${sortButtonHtml}
     </div>
     ${mustContainAllDescriptorsRowHtml}
    <br>
     ${listContainer}
  `;

  const totalDescriptors = allDescriptorsList.length;
  const visibleDescriptors = allDescriptorsList.reduce((count, dKey) => count + ((visibleSongCountsCache.descriptors[dKey] || 0) > 0 ? 1 : 0), 0);

  renderAccordionCell("#descriptors-cell", {
    key: "descriptors",
    title: "Descriptors",
    headerMetaHtml: `<span class="genre-count">${formatVisibleTotalCount(visibleDescriptors, totalDescriptors)}</span>`,
    bodyHtml: descriptorsBodyHtml
  });

  bindDescriptorViewDropdown();

  d3.select("#descriptors-must-contain-all").on("change", function() {
    mustContainAllSelectedDescriptors = !!this.checked;
    buildTable();
  });

  function setOrganizedDescriptorGroupState(container, nowOpen, immediate = false) {
    const bodyNode = container.select(".organized-descriptor-group-body").node();
    if (!bodyNode) return;

    container.classed("is-open", nowOpen).classed("is-closed", !nowOpen);
    container.select(".organized-descriptor-group-toggle").attr("aria-expanded", nowOpen ? "true" : "false");

    if (immediate) {
      bodyNode.style.display = nowOpen ? "block" : "none";
      bodyNode.style.maxHeight = nowOpen ? "none" : "0px";
      bodyNode.style.opacity = nowOpen ? "1" : "0";
      bodyNode.style.paddingTop = nowOpen ? "6px" : "0px";
      return;
    }

    if (nowOpen) {
      bodyNode.style.display = "block";
      bodyNode.style.maxHeight = "0px";
      bodyNode.style.opacity = "0";
      bodyNode.style.paddingTop = "0px";
      requestAnimationFrame(() => {
        bodyNode.style.maxHeight = `${bodyNode.scrollHeight}px`;
        bodyNode.style.opacity = "1";
        bodyNode.style.paddingTop = "6px";
      });
      const onOpenEnd = (event) => {
        if (event.propertyName !== "max-height") return;
        bodyNode.style.maxHeight = "none";
        bodyNode.removeEventListener("transitionend", onOpenEnd);
      };
      bodyNode.addEventListener("transitionend", onOpenEnd);
    } else {
      const currentHeight = bodyNode.scrollHeight;
      bodyNode.style.maxHeight = `${currentHeight}px`;
      bodyNode.style.opacity = "1";
      bodyNode.style.paddingTop = "6px";
      requestAnimationFrame(() => {
        bodyNode.style.maxHeight = "0px";
        bodyNode.style.opacity = "0";
        bodyNode.style.paddingTop = "0px";
      });
      const onCloseEnd = (event) => {
        if (event.propertyName !== "max-height") return;
        bodyNode.style.display = "none";
        bodyNode.removeEventListener("transitionend", onCloseEnd);
      };
      bodyNode.addEventListener("transitionend", onCloseEnd);
    }
  }

  function setOrganizedDescriptorSubgroupState(container, nowOpen, immediate = false) {
    const bodyNode = container.select(".organized-descriptor-subgroup-body").node();
    if (!bodyNode) return;

    container.classed("is-open", nowOpen).classed("is-closed", !nowOpen);
    container.select(".organized-descriptor-subgroup-toggle").attr("aria-expanded", nowOpen ? "true" : "false");

    if (immediate) {
      bodyNode.style.display = nowOpen ? "block" : "none";
      bodyNode.style.maxHeight = nowOpen ? "none" : "0px";
      bodyNode.style.opacity = nowOpen ? "1" : "0";
      bodyNode.style.paddingTop = nowOpen ? "6px" : "0px";
      return;
    }

    if (nowOpen) {
      bodyNode.style.display = "block";
      bodyNode.style.maxHeight = "0px";
      bodyNode.style.opacity = "0";
      bodyNode.style.paddingTop = "0px";
      requestAnimationFrame(() => {
        bodyNode.style.maxHeight = `${bodyNode.scrollHeight}px`;
        bodyNode.style.opacity = "1";
        bodyNode.style.paddingTop = "6px";
      });
      const onOpenEnd = (event) => {
        if (event.propertyName !== "max-height") return;
        bodyNode.style.maxHeight = "none";
        bodyNode.removeEventListener("transitionend", onOpenEnd);
      };
      bodyNode.addEventListener("transitionend", onOpenEnd);
    } else {
      const currentHeight = bodyNode.scrollHeight;
      bodyNode.style.maxHeight = `${currentHeight}px`;
      bodyNode.style.opacity = "1";
      bodyNode.style.paddingTop = "6px";
      requestAnimationFrame(() => {
        bodyNode.style.maxHeight = "0px";
        bodyNode.style.opacity = "0";
        bodyNode.style.paddingTop = "0px";
      });
      const onCloseEnd = (event) => {
        if (event.propertyName !== "max-height") return;
        bodyNode.style.display = "none";
        bodyNode.removeEventListener("transitionend", onCloseEnd);
      };
      bodyNode.addEventListener("transitionend", onCloseEnd);
    }
  }

  d3.selectAll(".organized-descriptor-group").each(function() {
    const container = d3.select(this);
    const group = container.attr("data-organized-descriptor-group");
    setOrganizedDescriptorGroupState(container, !!organizedDescriptorGroupState[group], true);
  });

  d3.selectAll(".organized-descriptor-subgroup").each(function() {
    const container = d3.select(this);
    const group = container.attr("data-organized-descriptor-subgroup-parent") || "";
    const subgroup = container.attr("data-organized-descriptor-subgroup") || "";
    const subgroupKey = `${group}::${subgroup}`;
    setOrganizedDescriptorSubgroupState(container, !!organizedDescriptorSubgroupState[subgroupKey], true);
  });

  d3.selectAll(".organized-descriptor-group-toggle").on("click", function(event) {
    const group = d3.select(this).attr("data-organized-descriptor-group");
    organizedDescriptorGroupState[group] = !organizedDescriptorGroupState[group];
    const container = d3.select(this.closest(".organized-descriptor-group"));
    setOrganizedDescriptorGroupState(container, organizedDescriptorGroupState[group]);
  });

  d3.selectAll(".organized-descriptor-group-toggle").on("keydown", function(event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    const group = d3.select(this).attr("data-organized-descriptor-group");
    organizedDescriptorGroupState[group] = !organizedDescriptorGroupState[group];
    const container = d3.select(this.closest(".organized-descriptor-group"));
    setOrganizedDescriptorGroupState(container, organizedDescriptorGroupState[group]);
  });

  d3.selectAll(".organized-descriptor-subgroup-toggle").on("click", function(event) {
    if (event && (event.target?.closest?.(".organized-descriptor-subgroup-checkbox"))) return;
    const subgroup = d3.select(this).attr("data-organized-descriptor-subgroup") || "";
    const group = d3.select(this).attr("data-organized-descriptor-subgroup-parent") || "";
    const subgroupKey = `${group}::${subgroup}`;
    organizedDescriptorSubgroupState[subgroupKey] = !organizedDescriptorSubgroupState[subgroupKey];
    const container = d3.select(this.closest(".organized-descriptor-subgroup"));
    setOrganizedDescriptorSubgroupState(container, organizedDescriptorSubgroupState[subgroupKey]);
  });

  d3.selectAll(".organized-descriptor-subgroup-toggle").on("keydown", function(event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    const subgroup = d3.select(this).attr("data-organized-descriptor-subgroup") || "";
    const group = d3.select(this).attr("data-organized-descriptor-subgroup-parent") || "";
    const subgroupKey = `${group}::${subgroup}`;
    organizedDescriptorSubgroupState[subgroupKey] = !organizedDescriptorSubgroupState[subgroupKey];
    const container = d3.select(this.closest(".organized-descriptor-subgroup"));
    setOrganizedDescriptorSubgroupState(container, organizedDescriptorSubgroupState[subgroupKey]);
  });

  syncOrganizedDescriptorGroupCheckboxes();
  syncOrganizedDescriptorSubgroupCheckboxes();

  d3.selectAll(".organized-descriptor-subgroup-checkbox")
    .on("click", function(event) {
      event.stopPropagation();
    })
    .on("change", function(event) {
      event.stopPropagation();
      const container = d3.select(this.closest(".organized-descriptor-subgroup"));
      const keysAttr = container.attr("data-organized-descriptor-subgroup-keys") || "";
      const subgroupDescriptorKeys = keysAttr.split("|").map(v => v.trim()).filter(Boolean);
      const newState = !!this.checked;

      subgroupDescriptorKeys.forEach((dKey) => {
        descriptorVisibility[dKey] = newState;
        d3.selectAll(`.descriptor-toggle[data-descriptor="${dKey}"]`).property("checked", newState);
      });

      invalidateSelectedFilterKeysCache();
      buildTable();
      rerenderCurrentPanel(false);
      syncOrganizedDescriptorGroupCheckboxes();
      syncOrganizedDescriptorSubgroupCheckboxes();
    });

  bindGenreClicks();
  updateContextColumn();

  d3.select("#toggle-all-descriptors").on("click", function() {
    toggleAllVisibility(descriptorVisibility);
    mustContainAllSelectedDescriptors = false;
    d3.select("#descriptors-must-contain-all").property("checked", false);
    refreshAllFilterToggleCheckboxes();
    syncOrganizedDescriptorGroupCheckboxes();
    syncOrganizedDescriptorSubgroupCheckboxes();
    renderChartRankHeader();
    buildTable();
    rerenderCurrentPanel(false);
    updateStatusBar();
    syncToggleAllButtonLabels();
  });

  const sortDescriptorsBtn = d3.select("#sort-descriptors-btn");
  if (!sortDescriptorsBtn.empty()) {
    bindSortDropdown(
      "descriptors",
      () => descriptorSortMode,
      (mode) => { descriptorSortMode = mode; },
      renderDescriptorsListCell
    );
  }
}

function bindGenreClicks() {
    d3.selectAll(".clickable-genre").on("click", function() {
      closeSongAccordion();
      showGenrePanel(d3.select(this).attr("data-genre"), true);
    });

    d3.selectAll(".clickable-descriptor").on("click", function() {
      closeSongAccordion();
      showDescriptorPanel(d3.select(this).attr("data-descriptor"), true);
    });

    d3.selectAll(".clickable-taxonomy").on("click", function() {
      showTaxonomyPanel(d3.select(this).attr("data-taxonomy"), true);
    });

    d3.selectAll(".clickable-country").on("click", function() {
      closeSongAccordion();
      showCountryPanel(d3.select(this).attr("data-country"), true);
    });

    d3.selectAll(".clickable-artist").on("click", function() {
      closeSongAccordion();
      showArtistPanel(d3.select(this).attr("data-artist"), true);
    });

    d3.selectAll(".genre-toggle").on("change", function() {
      const gKey = d3.select(this).attr("data-genre");
      genreVisibility[gKey] = this.checked;
      d3.selectAll(`.genre-toggle[data-genre="${gKey}"]`).property("checked", this.checked);
      invalidateSelectedFilterKeysCache();
      syncOrganizedGroupCheckboxes();
      buildTable();
      rerenderCurrentPanel(false);
      updateStatusBar();
      syncToggleAllButtonLabels();
    });

    d3.selectAll(".taxonomy-toggle").on("change", function() {
      const tKey = d3.select(this).attr("data-taxonomy");
      taxonomyVisibility[tKey] = this.checked;
      d3.selectAll(`.taxonomy-toggle[data-taxonomy="${tKey}"]`).property("checked", this.checked);
      buildTable();
      rerenderCurrentPanel(false);
      updateStatusBar();
      syncToggleAllButtonLabels();
    });

    d3.selectAll(".descriptor-toggle").on("change", function() {
      const dKey = d3.select(this).attr("data-descriptor");
      descriptorVisibility[dKey] = this.checked;
      d3.selectAll(`.descriptor-toggle[data-descriptor="${dKey}"]`).property("checked", this.checked);
      invalidateSelectedFilterKeysCache();
      syncOrganizedDescriptorGroupCheckboxes();
      syncOrganizedDescriptorSubgroupCheckboxes();
      buildTable();
      rerenderCurrentPanel(false);
      updateStatusBar();
      syncToggleAllButtonLabels();
    });

    d3.selectAll(".country-toggle").on("change", function() {
      const cKey = d3.select(this).attr("data-country");
      if (!cKey) return;
      countryVisibility[cKey] = this.checked;
      d3.selectAll(".country-toggle")
        .filter(function() { return d3.select(this).attr("data-country") === cKey; })
        .property("checked", this.checked);
      buildTable();
      rerenderCurrentPanel(false);
      updateStatusBar();
      syncToggleAllButtonLabels();
    });

    d3.selectAll(".artist-toggle").on("change", function() {
      const aKey = d3.select(this).attr("data-artist");
      if (!aKey) return;
      artistVisibility[aKey] = this.checked;
      d3.selectAll(".artist-toggle")
        .filter(function() { return d3.select(this).attr("data-artist") === aKey; })
        .property("checked", this.checked);
      buildTable();
      rerenderCurrentPanel(false);
      updateStatusBar();
      syncToggleAllButtonLabels();
    });

}
// Taxonomy side panel
function isOnlyVisibleSelected(visibilityMap, key) {
  if (!visibilityMap || !key) return false;
  const keys = Object.keys(visibilityMap);
  if (keys.length === 0) return false;
  return keys.every(k => (k === key ? visibilityMap[k] !== false : visibilityMap[k] === false));
}

function setOnlyVisibleSelected(visibilityMap, key, makeOnly) {
  if (!visibilityMap) return;
  Object.keys(visibilityMap).forEach(k => {
    visibilityMap[k] = makeOnly ? (k === key) : true;
  });
  invalidateSelectedFilterKeysCache();
}

function setAllVisibility(visibilityMap, value) {
  if (!visibilityMap) return;
  Object.keys(visibilityMap).forEach(k => {
    visibilityMap[k] = value;
  });
  invalidateSelectedFilterKeysCache();
}

function toggleAllVisibility(visibilityMap) {
  if (!visibilityMap) return;
  const allChecked = Object.values(visibilityMap).every(v => v);
  setAllVisibility(visibilityMap, !allChecked);
}

function toggleAllGenreVisibility() {
  const allChecked = Object.values(genreVisibility).every(v => v) &&
                     Object.values(taxonomyVisibility).every(v => v);
  const newState = !allChecked;
  setAllVisibility(genreVisibility, newState);
  setAllVisibility(taxonomyVisibility, newState);
  invalidateSelectedFilterKeysCache();
}

function refreshAllFilterToggleCheckboxes() {
  d3.selectAll(".genre-toggle").property("checked", function() {
    const gKey = d3.select(this).attr("data-genre");
    return genreVisibility[gKey] !== false;
  });
  d3.selectAll(".taxonomy-toggle").property("checked", function() {
    const tKey = d3.select(this).attr("data-taxonomy");
    return taxonomyVisibility[tKey] !== false;
  });
  d3.selectAll(".descriptor-toggle").property("checked", function() {
    const dKey = d3.select(this).attr("data-descriptor");
    return descriptorVisibility[dKey] !== false;
  });
  d3.selectAll(".country-toggle").property("checked", function() {
    const cKey = d3.select(this).attr("data-country");
    return countryVisibility[cKey] !== false;
  });
  d3.selectAll(".artist-toggle").property("checked", function() {
    const aKey = d3.select(this).attr("data-artist");
    return artistVisibility[aKey] !== false;
  });
}

function showAllFilters() {
  selectedYear = null;
  selectedRank = null;
  ratingMinFilter = 0.5;
  ratingMaxFilter = 5;
  setAllVisibility(genreVisibility, true);
  setAllVisibility(taxonomyVisibility, true);
  setAllVisibility(descriptorVisibility, true);
  setAllVisibility(countryVisibility, true);
  setAllVisibility(artistVisibility, true);
  refreshAllFilterToggleCheckboxes();
  syncOrganizedGroupCheckboxes();
  syncOrganizedDescriptorGroupCheckboxes();
  syncOrganizedDescriptorSubgroupCheckboxes();
  renderChartRankHeader();
  buildTable();
  rerenderCurrentPanel(false);
  updateStatusBar();
  syncToggleAllButtonLabels();
}

function applyShowOnlyFilter(filterType, key) {
  if (!filterType || !key) return;
  selectedYear = null;
  selectedRank = null;
  // "Show only" should also clear rating filters back to full range.
  ratingMinFilter = 0.5;
  ratingMaxFilter = 5;

  const maps = {
    genre: genreVisibility,
    taxonomy: taxonomyVisibility,
    descriptor: descriptorVisibility,
    country: countryVisibility,
    artist: artistVisibility
  };

  Object.entries(maps).forEach(([type, visibilityMap]) => {
    if (!visibilityMap) return;
    if (type === filterType) {
      setOnlyVisibleSelected(visibilityMap, key, true);
    } else {
      setAllVisibility(visibilityMap, true);
    }
  });

  refreshAllFilterToggleCheckboxes();
  syncOrganizedGroupCheckboxes();
  syncOrganizedDescriptorGroupCheckboxes();
  syncOrganizedDescriptorSubgroupCheckboxes();
  renderChartRankHeader();
  buildTable();
  rerenderCurrentPanel(false);
  updateStatusBar();
  syncToggleAllButtonLabels();
}

function handleSelectedOnlyToggleButtonClick() {
  const button = d3.select(this);
  const type = button.attr("data-only-type");
  if (!type) return;
  const key = button.attr(`data-${type}`);
  if (!key) return;

  const maps = {
    genre: genreVisibility,
    taxonomy: taxonomyVisibility,
    descriptor: descriptorVisibility,
    country: countryVisibility,
    artist: artistVisibility
  };

  const visibilityMap = maps[type];
  const makeOnly = !isOnlyVisibleSelected(visibilityMap, key);
  if (makeOnly) {
    applyShowOnlyFilter(type, key);
  } else {
    showAllFilters();
  }
}

function getWeeksAtNumberOneProxy(song) {
  const weeks = Number(song?.weeksOnChart) || 0;
  return song?.peakPos === 1 ? weeks : 0;
}

function getTopChartingSongs(songsList, limit = 3, options = {}) {
  const resolveSides = typeof options.resolveSides === "function"
    ? options.resolveSides
    : () => ["A", "B"];

  const baseList = Array.isArray(songsList) ? songsList : [];
  const list = [];

  // Alternative versions (same track, two artists) should appear as separate entries
  // when filtered by artist/country/etc (resolveSides narrows to the relevant side).
  baseList.forEach((song) => {
    if (!song) return;
    if (isAlternativeVersionSong(song)) {
      const sides = Array.isArray(resolveSides(song)) ? resolveSides(song) : ["A", "B"];
      const normalizedSides = Array.from(new Set(sides.map(s => (String(s).toUpperCase() === "B" ? "B" : "A"))));
      normalizedSides.forEach((side) => {
        list.push({ ...song, __topSongsSideOverride: side });
      });
      return;
    }

    list.push(song);
  });

  list.sort((a, b) => {
    const rankA = Number(a?.rank) || 9999;
    const rankB = Number(b?.rank) || 9999;
    if (rankA !== rankB) return rankA - rankB;

    const weeksAt1A = getWeeksAtNumberOneProxy(a);
    const weeksAt1B = getWeeksAtNumberOneProxy(b);
    if (weeksAt1A !== weeksAt1B) return weeksAt1B - weeksAt1A;

    const weeksA = Number(a?.weeksOnChart) || 0;
    const weeksB = Number(b?.weeksOnChart) || 0;
    if (weeksA !== weeksB) return weeksB - weeksA;

    const yearA = Number(a?.chartYear) || 0;
    const yearB = Number(b?.chartYear) || 0;
    return yearA - yearB;
  });

  return list.slice(0, Math.max(0, Number(limit) || 0));
}

function getSongBestRatingForSong(song, allowedSides = ["A", "B"]) {
  const normalizedSides = Array.isArray(allowedSides)
    ? allowedSides.map(s => String(s || "").toUpperCase())
    : ["A", "B"];
  const candidates = [];

  normalizedSides.forEach((side) => {
    const rating = getSongRatingsForSide(song, side).primary;
    if (rating && typeof rating.score === "number" && typeof rating.votes === "number" && rating.votes > 0) {
      candidates.push({ side, ...rating });
    }
  });

  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return b.votes - a.votes;
  });
  return candidates[0];
}

function getSongBestRatingSide(song, allowedSides = ["A", "B"]) {
  const bestRating = getSongBestRatingForSong(song, allowedSides);
  return bestRating ? bestRating.side : null;
}

function getSongRatingScoreForSong(song, allowedSides = ["A", "B"]) {
  const bestRating = getSongBestRatingForSong(song, allowedSides);
  return bestRating ? bestRating.score : null;
}

function getSongRatingVotesForSong(song, allowedSides = ["A", "B"]) {
  const bestRating = getSongBestRatingForSong(song, allowedSides);
  return bestRating ? bestRating.votes : 0;
}

function getTopRatedSongs(songsList, limit = 3, options = {}) {
  const resolveSides = typeof options.resolveSides === "function"
    ? options.resolveSides
    : () => ["A", "B"];

  const baseList = Array.isArray(songsList) ? songsList : [];
  const list = [];

  // Songs with multiple sides matching the filter should appear as separate entries in top-rated lists,
  // each sorted by its own side rating (A vs B), instead of sharing the best-side rating.
  // This applies to both alternative versions (same track, two artists) and A/B sides with different content.
  baseList.forEach((song) => {
    if (!song) return;
    const sides = Array.isArray(resolveSides(song)) ? resolveSides(song) : ["A", "B"];
    const normalizedSides = Array.from(new Set(sides.map(s => (String(s).toUpperCase() === "B" ? "B" : "A"))));
    
    // If multiple sides match the filter criteria, create separate entries for each
    if (normalizedSides.length > 1 || isAlternativeVersionSong(song)) {
      normalizedSides.forEach((side) => {
        const score = getSongRatingScoreForSide(song, side);
        if (score === null) return;
        list.push({ ...song, __topSongsSideOverride: side });
      });
      return;
    }

    list.push(song);
  });

  list.sort((a, b) => {
    const overrideA = a?.__topSongsSideOverride;
    const overrideB = b?.__topSongsSideOverride;

    const scoreA = overrideA
      ? Number(getSongRatingScoreForSide(a, overrideA))
      : Number(getSongRatingScoreForSong(a, resolveSides(a)));
    const scoreB = overrideB
      ? Number(getSongRatingScoreForSide(b, overrideB))
      : Number(getSongRatingScoreForSong(b, resolveSides(b)));
    if (scoreA !== scoreB) return scoreB - scoreA;

    const votesA = overrideA
      ? getSongRatingVotesForSide(a, overrideA)
      : getSongRatingVotesForSong(a, resolveSides(a));
    const votesB = overrideB
      ? getSongRatingVotesForSide(b, overrideB)
      : getSongRatingVotesForSong(b, resolveSides(b));
    if (votesA !== votesB) return votesB - votesA;

    const rankA = Number(a?.rank) || 9999;
    const rankB = Number(b?.rank) || 9999;
    if (rankA !== rankB) return rankA - rankB;

    const yearA = Number(a?.chartYear) || 0;
    const yearB = Number(b?.chartYear) || 0;
    return yearA - yearB;
  });

  return list
    .filter((song) => {
      const overrideSide = song?.__topSongsSideOverride;
      if (overrideSide) return getSongRatingScoreForSide(song, overrideSide) !== null;
      return getSongRatingScoreForSong(song, resolveSides(song)) !== null;
    })
    .slice(0, Math.max(0, Number(limit) || 0));
}

function getSongGenresForSide(song, side = "A") {
  const normalizedSide = (String(side || "A").toUpperCase() === "B") ? "B" : "A";

  // Data model:
  // - `primarygenre` + `subgenres` are always side A.
  // - `GenresB` (array) is always side B (may be empty/missing).
  if (normalizedSide === "B") {
    const genresB = Array.isArray(song?.GenresB) ? song.GenresB.filter(Boolean) : [];
    if (genresB.length > 0) {
      return {
        primarygenre: genresB[0] || null,
        subgenres: genresB.slice(1)
      };
    }
    // If no B-side genres are provided, inherit A-side genres (identical sides).
    return {
      primarygenre: song?.primarygenre || null,
      subgenres: Array.isArray(song?.subgenres) ? song.subgenres : []
    };
  }

  return {
    primarygenre: song?.primarygenre || null,
    subgenres: Array.isArray(song?.subgenres) ? song.subgenres : []
  };
}

function getAllSongGenres(song) {
  const a = getSongGenresForSide(song, "A");
  const b = getSongGenresForSide(song, "B");
  const set = new Set();

  if (a.primarygenre) set.add(a.primarygenre);
  (a.subgenres || []).forEach(g => g && set.add(g));
  if (b.primarygenre) set.add(b.primarygenre);
  (b.subgenres || []).forEach(g => g && set.add(g));

  return Array.from(set);
}

function getSongDescriptorsForSide(song, side = "A") {
  const normalizedSide = (String(side || "A").toUpperCase() === "B") ? "B" : "A";
  if (!song) return [];

  const listA = Array.isArray(song.descriptors) ? song.descriptors : [];
  const listB = Array.isArray(song.descriptorsB) ? song.descriptorsB : [];

  if (normalizedSide === "B") return listB.length ? listB : listA;
  return listA;
}

function getAllSongDescriptors(song) {
  const a = getSongDescriptorsForSide(song, "A");
  const b = getSongDescriptorsForSide(song, "B");
  const set = new Set();

  (a || []).forEach(d => d && set.add(d));
  (b || []).forEach(d => d && set.add(d));

  return Array.from(set);
}

function songHasDescriptor(song, descriptorKey) {
  if (!song || !descriptorKey) return false;
  return getAllSongDescriptors(song).some(d => String(d).toLowerCase() === String(descriptorKey).toLowerCase());
}

function songHasGenre(song, genreKey) {
  if (!song || !genreKey) return false;
  return getAllSongGenres(song).some(g => String(g).toLowerCase() === String(genreKey).toLowerCase());
}

function songSideHasAnyVisibleGenre(song, side) {
  const sideGenres = getSongGenresForSide(song, side);
  const list = [sideGenres.primarygenre, ...(sideGenres.subgenres || [])].filter(Boolean);
  if (list.length === 0) return false;
  return list.some(g => genreVisibility[g]);
}

function songSideHasAnyVisibleDescriptor(song, side) {
  const descriptors = getSongDescriptorsForSide(song, side);
  if (!descriptors || descriptors.length === 0) return false;
  return descriptors.some(d => descriptorVisibility[d]);
}

function isGenreFilterActive() {
  return !Object.values(genreVisibility).every(v => v);
}

function isDescriptorFilterActive() {
  const values = Object.values(descriptorVisibility);
  const anyVisible = values.some(v => v);
  const allVisible = values.every(v => v);
  return anyVisible && !allVisible;
}

function getVisibleSidesForSong(song) {
  const hasB = !!song?.tracks?.[1]?.youtubeId;
  const genreFilterActive = isGenreFilterActive();
  const descriptorFilterActive = isDescriptorFilterActive();
  const ratingFilterActive = ratingMinFilter > 0.5 || ratingMaxFilter < 5;
  
  if (!hasB) {
    if (!genreFilterActive && !descriptorFilterActive && !ratingFilterActive) return ["A"];

    const aContentOk = (!genreFilterActive && !descriptorFilterActive)
      ? true
      : (genreFilterActive && songSideHasAnyVisibleGenre(song, "A")) || (descriptorFilterActive && songSideHasAnyVisibleDescriptor(song, "A"));

    let aRatingOk = true;
    if (ratingFilterActive) {
      const sideARating = getSongRatingScoreForSide(song, "A");
      const aHasRating = sideARating !== null && Number.isFinite(Number(sideARating));
      aRatingOk = aHasRating && sideARating >= ratingMinFilter && sideARating <= ratingMaxFilter;
    }

    return (aContentOk && aRatingOk) ? ["A"] : [];
  }

  if (!genreFilterActive && !descriptorFilterActive && !ratingFilterActive) return ["A", "B"];

  // If genre/descriptor filters are inactive, both sides are "content-visible" by default.
  const aContentOk = (!genreFilterActive && !descriptorFilterActive)
    ? true
    : (genreFilterActive && songSideHasAnyVisibleGenre(song, "A")) || (descriptorFilterActive && songSideHasAnyVisibleDescriptor(song, "A"));
  const bContentOk = (!genreFilterActive && !descriptorFilterActive)
    ? true
    : (genreFilterActive && songSideHasAnyVisibleGenre(song, "B")) || (descriptorFilterActive && songSideHasAnyVisibleDescriptor(song, "B"));

  let aRatingOk = true;
  let bRatingOk = true;

  if (ratingFilterActive) {
    const sideARating = getSongRatingScoreForSide(song, "A");
    const sideBRating = getSongRatingScoreForSide(song, "B");

    const aHasRating = sideARating !== null && Number.isFinite(Number(sideARating));
    const bHasRating = sideBRating !== null && Number.isFinite(Number(sideBRating));

    // If rating filter is active and neither side has rating data, exclude the song.
    if (!(aHasRating || bHasRating)) {
      aRatingOk = false;
      bRatingOk = false;
    } else {
      aRatingOk = aHasRating && sideARating >= ratingMinFilter && sideARating <= ratingMaxFilter;
      bRatingOk = bHasRating && sideBRating >= ratingMinFilter && sideBRating <= ratingMaxFilter;
    }
  }

  const sides = [];
  if (aContentOk && aRatingOk) sides.push("A");
  if (bContentOk && bRatingOk) sides.push("B");

  return sides;
}

function getSongSidesContainingGenre(song, genreKey) {
  const key = String(genreKey || "").trim().toLowerCase();
  if (!key) return [];

  const sides = [];
  ["A", "B"].forEach((side) => {
    const g = getSongGenresForSide(song, side);
    const list = [g.primarygenre, ...(g.subgenres || [])]
      .filter(Boolean)
      .map(v => String(v).toLowerCase());
    if (list.includes(key)) sides.push(side);
  });

  return sides;
}

function getSongSidesContainingDescriptor(song, descriptorKey) {
  const key = String(descriptorKey || "").trim().toLowerCase();
  if (!key) return [];

  const sides = [];
  ["A", "B"].forEach((side) => {
    const list = getSongDescriptorsForSide(song, side)
      .filter(Boolean)
      .map(v => String(v).toLowerCase());
    if (list.includes(key)) sides.push(side);
  });

  return sides;
}

function getSongSidesContainingArtist(song, artistName) {
  const key = String(artistName || "").trim().toLowerCase();
  if (!key) return [];

  const artists = Array.isArray(song?.artists) ? song.artists : [];
  if (!artists.length) return [];

  const hasB = !!song?.tracks?.[1]?.youtubeId;

  if (!hasB) {
    if (artists.some(a => String(a || "").toLowerCase() === key)) {
      return ["A"];
    }
    return [];
  }

  const normalizedArtists = artists.map(a => String(a || "").toLowerCase());

  // Most songs treat collaborations as applying to the whole single (both sides).
  // Only "alternative version" entries are truly side-specific by artist index.
  if (!isAlternativeVersionSong(song)) {
    return normalizedArtists.includes(key) ? ["A", "B"] : [];
  }

  // Alternative version: artist index maps to side A/B.
  const sides = [];
  if (normalizedArtists[0] === key) sides.push("A");
  if (normalizedArtists[1] === key) sides.push("B");
  if (sides.length) return sides;

  // Fallback for incomplete data: if artist appears anywhere, allow both.
  return normalizedArtists.includes(key) ? ["A", "B"] : [];
}

function getSongSidesContainingCountry(song, countryCode) {
  const key = String(countryCode || "").trim().toLowerCase();
  if (!key) return [];

  const codes = song?.countryCode;
  const hasB = !!song?.tracks?.[1]?.youtubeId;

  // For most songs (including collaborations), countries apply to the whole single.
  // Alternative versions can be side-specific (one artist per side).
  if (hasB && !isAlternativeVersionSong(song)) {
    if (Array.isArray(codes)) {
      const normalizedCodes = codes.map(c => String(c || "").trim().toLowerCase());
      return normalizedCodes.includes(key) ? ["A", "B"] : [];
    }
    if (typeof codes === "string" && String(codes || "").trim().toLowerCase() === key) {
      return ["A", "B"];
    }
    return [];
  }

  const sides = [];
  if (Array.isArray(codes)) {
    if (String(codes[0] || "").trim().toLowerCase() === key) sides.push("A");
    if (hasB && String(codes[1] || "").trim().toLowerCase() === key) sides.push("B");
    if (sides.length) return sides;
  }

  if (typeof codes === "string" && String(codes || "").trim().toLowerCase() === key) {
    return hasB ? ["A", "B"] : ["A"];
  }

  // fallback for country arrays of length 1: if the single country matches, apply it to both sides.
  if (Array.isArray(codes) && codes.length === 1 && String(codes[0] || "").trim().toLowerCase() === key) {
    return hasB ? ["A", "B"] : ["A"];
  }

  return [];
}

function getSongTitleForSides(song, sides) {
  const titleA = song?.tracks?.[0]?.title || "Untitled";
  const titleB = song?.tracks?.[1]?.title || "";
  const hasB = !!song?.tracks?.[1]?.youtubeId;
  if (!hasB) return titleA;

  const normalized = Array.isArray(sides) ? sides : [];
  const unique = Array.from(new Set(normalized.map(s => (String(s).toUpperCase() === "B" ? "B" : "A"))));

  if (unique.length === 2) return titleB ? `${titleA} / ${titleB}` : titleA;
  if (unique[0] === "B") return titleB || titleA;
  return titleA;
}

function getSongRatingsForSide(song, side = "A") {
  const normalizedSide = (String(side || "A").toUpperCase() === "B") ? "B" : "A";
  const singleKey = `singleRating${normalizedSide}`;
  const trackKey = `trackRating${normalizedSide}`;

  const singleRating = song[singleKey];
  const trackRating = song[trackKey];

  let primaryScore = null;
  let primaryVotes = 0;

  const ratings = [];

  if (singleRating && typeof singleRating.score === 'number' && typeof singleRating.votes === 'number' && singleRating.votes > 0) {
    ratings.push(singleRating);
  }

  if (trackRating && typeof trackRating.score === 'number' && typeof trackRating.votes === 'number' && trackRating.votes > 0) {
    ratings.push(trackRating);
  }

  if (ratings.length > 0) {
    let totalWeightedScore = 0;
    let totalVotes = 0;
    ratings.forEach(r => {
      totalWeightedScore += r.score * r.votes;
      totalVotes += r.votes;
    });
    primaryScore = totalWeightedScore / totalVotes;
    primaryVotes = totalVotes;
  }

  return {
    primary: primaryScore !== null ? { score: primaryScore, votes: primaryVotes } : null,
    single: singleRating || null,
    track: trackRating || null
  };
}

function getSongRatingScoreForSide(song, side = "A") {
  const ratings = getSongRatingsForSide(song, side);
  return ratings?.primary?.score || null;
}

function getSongRatingVotesForSide(song, side = "A") {
  const ratings = getSongRatingsForSide(song, side);
  return ratings?.primary?.votes || 0;
}

function isAlternativeVersionSong(song) {
  const artists = Array.isArray(song?.artists) ? song.artists : [];
  const trackA = song?.tracks?.[0];
  const trackB = song?.tracks?.[1];
  const hasBPlayable = !!trackB?.youtubeId;
  if (!hasBPlayable) return false;
  if (!trackA?.youtubeId) return false;
  if (artists.length !== 2) return false;

  const titleA = String(trackA?.title || "").trim().toLowerCase();
  const titleB = String(trackB?.title || "").trim().toLowerCase();

  // Alternative version: two artists + two youtube ids + one title (B missing or same as A).
  if (!titleB) return true;
  if (titleA && titleA === titleB) return true;
  return false;
}

function getArtistsForSide(song, side = "A") {
  const artists = Array.isArray(song?.artists) ? song.artists : [];
  const countries = Array.isArray(song?.countryCode) ? song.countryCode : [];
  const normalizedSide = (String(side || "A").toUpperCase() === "B") ? "B" : "A";
  const hasB = !!song?.tracks?.[1]?.youtubeId;

  if (!hasB) {
    return artists
      .map((artist, index) => {
        if (!artist) return null;
        const c = countries[index] || (countries.length === 1 ? countries[0] : "") || "";
        return { artist, country: c };
      })
      .filter(Boolean);
  }

  if (artists.length <= 1) {
    const a = artists[0] || "";
    const c = countries[0] || "";
    return a ? [{ artist: a, country: c }] : [];
  }

  // Collaborations list together on both sides, except for alternative versions.
  if (!isAlternativeVersionSong(song)) {
    return artists
      .map((artist, index) => {
        if (!artist) return null;
        const c = countries[index] || (countries.length === 1 ? countries[0] : "") || "";
        return { artist, country: c };
      })
      .filter(Boolean);
  }

  // Alternative version: one artist per side.
  const index = normalizedSide === "B" ? 1 : 0;
  const a = artists[index] || artists[0] || "";
  const c = countries[index] || (countries.length === 1 ? countries[0] : "") || "";
  return a ? [{ artist: a, country: c }] : [];
}

function getPreferredVisibleSongSide(song) {
  const visibleSides = getVisibleSidesForSong(song);
  if (visibleSides.length === 1) return visibleSides[0];
  if (visibleSides.includes(selectedSongSide)) return selectedSongSide;
  return visibleSides.includes("A") ? "A" : "B";
}

function getEffectiveVisibleSongSide(song) {
  const visibleSides = getVisibleSidesForSong(song);
  return visibleSides.length === 1 ? visibleSides[0] : getPreferredVisibleSongSide(song);
}

function getFilteredHoverTitleForSong(song) {
  const sides = getVisibleSidesForSong(song);
  return getSongTitleForSides(song, sides);
}

function getSongArtistSeparator(song, fallback = " • ") {
  if (isAlternativeVersionSong(song)) return " / ";
  return fallback;
}

function getFilteredHoverArtistsForSong(song) {
  const artists = Array.isArray(song?.artists) ? song.artists : [];
  if (!isAlternativeVersionSong(song)) {
    return artists;
  }

  const visibleSides = getVisibleSidesForSong(song);
  if (visibleSides.length === 2) {
    return artists;
  }

  if (visibleSides.length === 1) {
    const side = visibleSides[0];
    const index = side === "B" ? 1 : 0;
    return artists[index] ? [artists[index]] : artists;
  }

  return artists;
}

function buildTopSongsSectionHtmlForItem(songsList, options = {}) {
  const topChartSongs = getTopChartingSongs(songsList, 3, options);
  const topRatedSongs = getTopRatedSongs(songsList, 3, options);
  return buildTopSongsSectionHtml(topChartSongs, topRatedSongs, options);
}

function buildTopSongsSectionHtml(topChartSongs, topRatedSongs, options = {}) {
  const resolveSides = typeof options.resolveSides === "function"
    ? options.resolveSides
    : (song) => getVisibleSidesForSong(song);

  const selectedMode = options.mode === "ratings" || topSongsMode === "ratings" ? "ratings" : "chart";

  const chartRowsHtml = buildTopSongRowsHtml(topChartSongs, "chart", resolveSides);
  const ratingRowsHtml = buildTopSongRowsHtml(topRatedSongs, "ratings", resolveSides);

  const chartContentHtml = chartRowsHtml.length
    ? `<ul class="top-songs-list top-songs-list--chart" style="display:${selectedMode === "chart" ? "" : "none"}">${chartRowsHtml}</ul>`
    : `<p class="top-songs-empty top-songs-empty--chart" style="display:${selectedMode === "chart" ? "" : "none"}">No songs found.</p>`;

  const ratingsContentHtml = ratingRowsHtml.length
    ? `<ul class="top-songs-list top-songs-list--ratings" style="display:${selectedMode === "ratings" ? "" : "none"}">${ratingRowsHtml}</ul>`
    : `<p class="top-songs-empty top-songs-empty--ratings" style="display:${selectedMode === "ratings" ? "" : "none"}">No rated songs found.</p>`;

  return `
    <div class="top-songs-section">
      <div class="top-songs-section-header">
        <h2>Top Songs</h2>
        <div class="sort-dropdown top-songs-mode-dropdown" data-sort-dropdown="top-songs">
          <button type="button" class="sort-dropdown-trigger" aria-haspopup="true" aria-expanded="false">
            ${selectedMode === "ratings" ? "Ratings" : "Chart"} <span class="icon">&#x25BE;</span>
          </button>
          <div class="sort-dropdown-menu">
            <div class="sort-dropdown-title">Top Songs</div>
            <button type="button" class="sort-dropdown-option${selectedMode === "chart" ? " sort-dropdown-option--selected" : ""}" data-top-songs-mode="chart">Chart</button>
            <button type="button" class="sort-dropdown-option${selectedMode === "ratings" ? " sort-dropdown-option--selected" : ""}" data-top-songs-mode="ratings">Ratings</button>
          </div>
        </div>
      </div>
      <p class="top-songs-disclaimer top-songs-disclaimer--chart" style="display:${selectedMode === "chart" ? "" : "none"}">Top ranked songs based on year end chart position and weeks at #1.</p>
      <p class="top-songs-disclaimer top-songs-disclaimer--ratings" style="display:${selectedMode === "ratings" ? "" : "none"}">Top rated songs based on average weighted rating.</p>
      ${chartContentHtml}
      ${ratingsContentHtml}
    </div>
  `;
}

function buildTopSongRowsHtml(songs, mode, resolveSides) {
  const list = Array.isArray(songs) ? songs : [];
  return list.map((song) => {
    const hasB = !!song?.tracks?.[1]?.youtubeId;
    const titleA = song?.tracks?.[0]?.title || "Untitled";
    const titleB = song?.tracks?.[1]?.title || "";
    const year = song?.chartYear ?? "";
    const rank = song?.rank ?? "";
    const artists = Array.isArray(song?.artists) ? song.artists : [];
    const artistSeparator = getSongArtistSeparator(song);
    const isMultiVersionSameTrack = isAlternativeVersionSong(song);
    const topSongsSideOverride = song?.__topSongsSideOverride;

    let metaText = "";
    if (mode === "chart") {
      const peak = song?.peakPos ?? "";
      const weeksAt1 = getWeeksAtNumberOneProxy(song);
      const metaParts = [`#${rank}`, `${year}`];
      if (Number.isFinite(Number(peak))) metaParts.push(`Peak #${peak}`);
      if (weeksAt1 > 0) metaParts.push(`${weeksAt1}w at #1`);
      metaText = metaParts.join("  •  ");
    } else {
      const relevantSides = typeof resolveSides === "function" ? resolveSides(song) : ["A", "B"];
      const score = topSongsSideOverride
        ? getSongRatingScoreForSide(song, topSongsSideOverride)
        : getSongRatingScoreForSong(song, relevantSides);
      const votes = topSongsSideOverride
        ? getSongRatingVotesForSide(song, topSongsSideOverride)
        : getSongRatingVotesForSong(song, relevantSides);
      metaText = score !== null
        ? `${score.toFixed(2)}/5 from ${votes} rating${votes === 1 ? "" : "s"}`
        : "No rating data";
    }

    const artistRowHtml = (isMultiVersionSameTrack && topSongsSideOverride)
      ? `
        <div class="top-song-artists">
          <span class="top-song-artists-text">${artists[topSongsSideOverride === "B" ? 1 : 0] || ""}</span>
        </div>
      `
      : isMultiVersionSameTrack
      ? `
        <div class="top-song-artists">
          <button type="button" class="top-song-artist-btn" data-song-year="${year}" data-song-rank="${rank}" data-song-side="A">${artists[0] || ""}</button>
          <span class="top-song-artist-sep" aria-hidden="true">/</span>
          <button type="button" class="top-song-artist-btn" data-song-year="${year}" data-song-rank="${rank}" data-song-side="B">${artists[1] || ""}</button>
        </div>
      `
      : `
        <div class="top-song-artists">
          <span class="top-song-artists-text">${artists.join(artistSeparator)}</span>
        </div>
      `;

    let sidesForTitle = resolveSides(song);
    let normalizedSides = Array.isArray(sidesForTitle)
      ? Array.from(new Set(sidesForTitle.map(s => (String(s).toUpperCase() === "B" ? "B" : "A"))))
      : [];

    if (mode === "ratings") {
      if (topSongsSideOverride) {
        normalizedSides = [topSongsSideOverride];
      } else {
        const bestSide = getSongBestRatingSide(song, normalizedSides.length ? normalizedSides : ["A", "B"]);
        if (bestSide) normalizedSides = [bestSide];
      }
    }

    const titleButtonsHtml = (() => {
      if (isMultiVersionSameTrack) {
        const side = topSongsSideOverride ? topSongsSideOverride : "A";
        const baseTitle = getSongTitleForSides(song, [side]) || titleA;
        return `<button type="button" class="top-song-btn" data-song-year="${year}" data-song-rank="${rank}" data-song-side="${side}">${baseTitle}</button>`;
      }

      if (!hasB || normalizedSides.length <= 1) {
        const side = normalizedSides[0] || "A";
        const displayTitle = getSongTitleForSides(song, [side]);
        return `<button type="button" class="top-song-btn" data-song-year="${year}" data-song-rank="${rank}" data-song-side="${side}">${displayTitle}</button>`;
      }

      const safeTitleB = titleB || titleA;
      return `
        <button type="button" class="top-song-btn" data-song-year="${year}" data-song-rank="${rank}" data-song-side="A">${titleA}</button>
        <span class="top-song-sep" aria-hidden="true">/</span>
        <button type="button" class="top-song-btn top-song-btn--side" data-song-year="${year}" data-song-rank="${rank}" data-song-side="B">${safeTitleB}</button>
      `;
    })();

    return `
      <li class="top-song-row">
        <div class="top-song-main">
          <div class="top-song-title">
            ${titleButtonsHtml}
          </div>
          ${artistRowHtml}
        </div>
        <span class="top-song-meta">${metaText}</span>
      </li>
    `;
  }).join("");
}

function bindTopSongsModeDropdown(containerSelector = "#info-cell") {
  const root = d3.select(containerSelector);
  if (root.empty()) return;

  root.selectAll('.sort-dropdown[data-sort-dropdown="top-songs"]').each(function() {
    const dropdown = d3.select(this);
    const trigger = dropdown.select(".sort-dropdown-trigger");
    const options = dropdown.selectAll(".sort-dropdown-option");

    const setMode = (mode) => {
      options.classed("sort-dropdown-option--selected", function() {
        return d3.select(this).attr("data-top-songs-mode") === mode;
      });

      trigger.html(`${mode === "ratings" ? "Ratings" : "Chart"} <span class="icon">&#x25BE;</span>`);
      dropdown.attr("data-top-songs-mode", mode);

      const parent = dropdown.node().closest(".top-songs-section");
      if (!parent) return;
      const section = d3.select(parent);

      section.selectAll(".top-songs-list").style("display", "none");
      section.selectAll(".top-songs-disclaimer").style("display", "none");
      section.selectAll(".top-songs-empty").style("display", "none");

      section.select(`.top-songs-list--${mode}`).style("display", null);
      section.select(`.top-songs-disclaimer--${mode}`).style("display", null);
      if (mode === "ratings") {
        const ratingList = section.select(".top-songs-list--ratings");
        if (ratingList.empty() || !ratingList.html().trim()) {
          section.select(".top-songs-empty--ratings").style("display", null);
        }
      } else {
        const chartList = section.select(".top-songs-list--chart");
        if (chartList.empty() || !chartList.html().trim()) {
          section.select(".top-songs-empty--chart").style("display", null);
        }
      }
    };

    trigger.on("click", function(event) {
      event.stopPropagation();
      const isOpen = dropdown.classed("is-open");
      closeAllSortDropdowns();
      if (!isOpen) {
        dropdown.classed("is-open", true);
        trigger.attr("aria-expanded", "true");
      }
    });

    options.on("click", function(event) {
      event.stopPropagation();
      const nextMode = d3.select(this).attr("data-top-songs-mode");
      if (nextMode) {
        topSongsMode = nextMode;
        setMode(nextMode);
      }
      closeAllSortDropdowns();
    });

    setMode(topSongsMode);
  });
}

function resolveSongIndexByYearRank(chartYear, rank) {
  const yearNum = Number(chartYear);
  const rankNum = Number(rank);
  if (!Number.isFinite(yearNum) || !Number.isFinite(rankNum)) return -1;

  const matcher = (song) => song && Number(song.chartYear) === yearNum && Number(song.rank) === rankNum;
  let idx = currentSongList.findIndex(matcher);
  if (idx !== -1) return idx;

  // If the current chart is filtered (year/rank), clear filters so the requested song is present.
  // This avoids "wrong song" behavior caused by stale indices when the table is rebuilt.
  const hadYearFilter = selectedYear !== null;
  const hadRankFilter = selectedRank !== null;
  if (hadYearFilter || hadRankFilter) {
    selectedYear = null;
    selectedRank = null;
    buildTable();
    idx = currentSongList.findIndex(matcher);
  }
  return idx;
}

function bindTopSongButtons(containerSelector = "#info-cell") {
  d3.select(containerSelector).selectAll(".top-song-btn, .top-song-artist-btn").on("click", function() {
    const side = d3.select(this).attr("data-song-side") || "A";
    const year = d3.select(this).attr("data-song-year");
    const rank = d3.select(this).attr("data-song-rank");
    const songIndex = resolveSongIndexByYearRank(year, rank);
    if (!Number.isFinite(songIndex) || songIndex < 0) return;
    showSongModal(songIndex, side, false, true, true);
  });
}

function showTaxonomyPanel(taxKey, resetScroll = true, forceOpen = true) {
  closeSongAccordion();
  if (forceOpen) accordionState.selected = true;
    currentPanel = { type: "taxonomy", key: taxKey };

    const info = taxonomy[taxKey];
    if (!info) return;

    // Open context column if empty
    if (d3.select(".context-column").classed("empty")) {
      d3.select(".context-column").classed("empty", false);
    }

    const relatedHtml = Array.isArray(info.related) && info.related.length
      ? info.related.map(r => {
          const g = genres[r];
          const totalCount = genreCounts[r] || 0;
          const visibleCount = visibleSongCountsCache.genres[r] || 0;
          return `
            <li>
              <input type="checkbox" class="genre-toggle" data-genre="${r}" ${genreVisibility[r] !== false ? "checked" : ""}>
              <span class="clickable-genre" data-genre="${r}">${g ? g.label : r}</span> <span class="genre-count">${formatVisibleTotalCount(visibleCount, totalCount)}</span>
            </li>
          `;
        }).join("")
      : "";

    const relatedSectionHtml = relatedHtml ? `<h2>Key Genres:</h2><br><ul>${relatedHtml}</ul>` : "";
    const taxonomyCountTotal = songs.filter(s => s.genretaxonomy === taxKey).length;
    const taxonomyCountVisible = visibleSongCountsCache.taxonomy[taxKey] || 0;

    const headerMetaHtml = `
      <div class="selected-main-row selected-main-row--summary">
        <input type="checkbox" class="taxonomy-toggle" data-taxonomy="${taxKey}" ${taxonomyVisibility[taxKey] !== false ? "checked" : ""}>
        <span class="genre-badge" style="${getTaxonomyBadgeStyle(info.color)}">${info.label}</span>
        <span class="genre-count">${formatVisibleTotalCount(taxonomyCountVisible, taxonomyCountTotal)}</span>
      </div>
    `;

    const taxonomyOnlySelected = isOnlyVisibleSelected(taxonomyVisibility, taxKey);
    const taxonomyOnlyLabel = taxonomyOnlySelected ? "Show all" : "Show only";
    const taxonomySongs = songs.filter(s => s && s.genretaxonomy === taxKey);
    const topTaxSongsSectionHtml = buildTopSongsSectionHtmlForItem(taxonomySongs);

    const infoBodyHtml = `
      <button type="button" class="selected-only-toggle" data-only-type="taxonomy" data-taxonomy="${taxKey}">${taxonomyOnlyLabel}</button>
      <p>${info.description || ""}</p>
      ${relatedSectionHtml ? `<br>${relatedSectionHtml}` : ""}
      ${topTaxSongsSectionHtml}
    `;

    renderAccordionCell("#info-cell", {
      key: "selected",
      title: "",
      headerMetaHtml,
      bodyHtml: infoBodyHtml,
      headerBorderColor: info.color
    });

    if (resetScroll) scrollLeftPanelToTop();
    

    
    bindGenreClicks();

    d3.select("#info-cell").selectAll(".selected-only-toggle").on("click", handleSelectedOnlyToggleButtonClick);

    bindTopSongButtons("#info-cell");
    bindTopSongsModeDropdown("#info-cell");
  }

  // Genre side panel 

  function showGenrePanel(genreKey, resetScroll = true, forceOpen = true) {
    if (forceOpen) accordionState.selected = true;

    // resolve case sensitivity if needed/ consistency with them all and json
    let resolvedKey = genreKey;
    if (!genres[genreKey]) {
      const found = Object.keys(genres).find(k => k.toLowerCase() === String(genreKey).toLowerCase());
      if (found) resolvedKey = found;
    }
    currentPanel = { type: "genre", key: resolvedKey };

    const g = genres[resolvedKey];
    // if no detailed info is supplied for the genre
    if (!g) {
      const genreOnlySelected = isOnlyVisibleSelected(genreVisibility, resolvedKey);
      const genreOnlyLabel = genreOnlySelected ? "Show all" : "Show only";
      const genreSongs = currentSongList.filter(s => songHasGenre(s, resolvedKey));
      const topGenreSongsSectionHtml = buildTopSongsSectionHtmlForItem(genreSongs, {
        resolveSides: (song) => getSongSidesContainingGenre(song, resolvedKey)
      });

      const headerMetaHtml = `
        <div class="selected-main-row selected-main-row--summary">
          <input type="checkbox" class="genre-toggle" data-genre="${resolvedKey}" ${genreVisibility[resolvedKey] !== false ? "checked" : ""}>
          <span class="selected-main-label">${resolvedKey}</span>
          <span class="genre-count">${formatVisibleTotalCount(visibleSongCountsCache.genres[resolvedKey] || 0, genreCounts[resolvedKey] || 0)}</span>
        </div>
      `;

      const infoBodyHtml = `
        <button type="button" class="selected-only-toggle" data-only-type="genre" data-genre="${resolvedKey}">${genreOnlyLabel}</button>
        <p>No info on this genre.</p>
      ${topGenreSongsSectionHtml}
      `;

      renderAccordionCell("#info-cell", {
        key: "selected",
        title: "",
        headerMetaHtml,
        bodyHtml: infoBodyHtml
      });

      if (resetScroll) scrollLeftPanelToTop();
      bindGenreClicks();

      d3.select("#info-cell").selectAll(".selected-only-toggle").on("click", handleSelectedOnlyToggleButtonClick);

      bindTopSongButtons("#info-cell");
      bindTopSongsModeDropdown("#info-cell");
      return;
    }

    // taxonomy badge and related genres list
    const taxInfo = taxonomy[g.taxonomy];
    const taxBadge = taxInfo
      ? `<span class="genre-badge clickable-taxonomy" style="${getTaxonomyBadgeStyle(taxInfo.color)}" data-taxonomy="${g.taxonomy}">${taxInfo.label}</span>`
      : `<span class="genre-badge clickable-taxonomy" data-taxonomy="${g.taxonomy}">${g.taxonomy}</span>`;

    const relatedHtml = Array.isArray(g.related) && g.related.length
      ? g.related.map(r => `
          <li>
            <input type="checkbox" class="genre-toggle" data-genre="${r}" ${genreVisibility[r] !== false ? "checked" : ""}>
            <span class="clickable-genre" data-genre="${r}">${genres[r]?.label || r}</span> <span class="genre-count">${formatVisibleTotalCount(visibleSongCountsCache.genres[r] || 0, genreCounts[r] || 0)}</span>
          </li>
        `).join("")
      : "";

    const relatedSectionHtml = relatedHtml ? `<h2>Related genres:</h2><br><ul>${relatedHtml}</ul>` : "";

    const headerMetaHtml = `
      <div class="selected-main-row selected-main-row--summary">
        <input type="checkbox" class="genre-toggle" data-genre="${resolvedKey}" ${genreVisibility[resolvedKey] !== false ? "checked" : ""}>
        <span class="selected-main-label">${g.label}</span>
        <span class="genre-count">${formatVisibleTotalCount(visibleSongCountsCache.genres[resolvedKey] || 0, genreCounts[resolvedKey] || 0)}</span>
      </div>
    `;

    const infoBodyHtml = `
      <div class="selected-item-toolbar">
        <button type="button" class="selected-only-toggle" data-only-type="genre" data-genre="${resolvedKey}">${isOnlyVisibleSelected(genreVisibility, resolvedKey) ? "Show all" : "Show only"}</button>

      </div>
      <p>${g.description || ""}</p>
      ${g.link ? `<p><a href="${g.link}" target="_blank" rel="noopener noreferrer">Learn more🡥</a></p>` : ""}
      ${relatedSectionHtml ? `<br>${relatedSectionHtml}` : ""}
      ${buildTopSongsSectionHtmlForItem(
        songs.filter(s => songHasGenre(s, resolvedKey)),
        { resolveSides: (song) => getSongSidesContainingGenre(song, resolvedKey) }
      )}
    `;

    renderAccordionCell("#info-cell", {
      key: "selected",
      title: "",
      headerMetaHtml,
      bodyHtml: infoBodyHtml,
      headerBorderColor: taxInfo?.color || ""
    });

    if (resetScroll) scrollLeftPanelToTop();
    
    
    bindGenreClicks();

    d3.select("#info-cell").selectAll(".selected-only-toggle").on("click", handleSelectedOnlyToggleButtonClick);

    bindTopSongButtons("#info-cell");
    bindTopSongsModeDropdown("#info-cell");
  }



  function showDescriptorPanel(descriptorKey, resetScroll = true, forceOpen = true) {
    if (forceOpen) accordionState.selected = true;

    let resolvedKey = descriptorKey;
    if (!descriptors[descriptorKey]) {
      const found = Object.keys(descriptors).find(k => k.toLowerCase() === String(descriptorKey).toLowerCase());
      if (found) resolvedKey = found;
    }
    currentPanel = { type: "descriptor", key: resolvedKey };

    const meta = descriptors[resolvedKey];

    if (d3.select(".context-column").classed("empty")) {
      d3.select(".context-column").classed("empty", false);
    }

    const descriptorOnlySelected = isOnlyVisibleSelected(descriptorVisibility, resolvedKey);
    const descriptorOnlyLabel = descriptorOnlySelected ? "Show all" : "Show only";

    const descriptorSongs = songs.filter(s => songHasDescriptor(s, resolvedKey));
    const topDescriptorSongsSectionHtml = buildTopSongsSectionHtmlForItem(descriptorSongs, {
      resolveSides: (song) => getSongSidesContainingDescriptor(song, resolvedKey)
    });

    const headerMetaHtml = `
      <div class="selected-main-row selected-main-row--summary">
        <input type="checkbox" class="descriptor-toggle" data-descriptor="${resolvedKey}" ${descriptorVisibility[resolvedKey] !== false ? "checked" : ""}>
        <span class="selected-main-label">${meta?.label || resolvedKey}</span>
        <span class="genre-count">${formatVisibleTotalCount(visibleSongCountsCache.descriptors[resolvedKey] || 0, descriptorCounts[resolvedKey] || 0)}</span>
      </div>
    `;

    const infoBodyHtml = `
      <button type="button" class="selected-only-toggle" data-only-type="descriptor" data-descriptor="${resolvedKey}">${descriptorOnlyLabel}</button>
      <p>${meta?.description || "No info on this descriptor."}</p>
      ${topDescriptorSongsSectionHtml}
    `;

    renderAccordionCell("#info-cell", {
      key: "selected",
      title: "",
      headerMetaHtml,
      bodyHtml: infoBodyHtml
    });

    if (resetScroll) scrollLeftPanelToTop();
    bindGenreClicks();

    d3.select("#info-cell").selectAll(".selected-only-toggle").on("click", handleSelectedOnlyToggleButtonClick);

    bindTopSongButtons("#info-cell");
    bindTopSongsModeDropdown("#info-cell");
  }

  function showCountryPanel(countryCode, resetScroll = true, forceOpen = true) {
    closeSongAccordion();
    if (forceOpen) accordionState.selected = true;
    const code = String(countryCode || "").trim();
    if (!code) return;

    currentPanel = { type: "country", key: code };

    if (d3.select(".context-column").classed("empty")) {
      d3.select(".context-column").classed("empty", false);
    }

    const countrySongsAll = songs.filter(s => {
      const codes = s?.countryCode;
      if (Array.isArray(codes)) return codes.includes(code);
      if (typeof codes === "string") return codes === code;
      return false;
    });

    const totalCount = countrySongsAll.length;
    const visibleCount = visibleSongCountsCache.countries[code] || 0;
    const flagClass = getFlagIconClass(code);

    const headerMetaHtml = `
      <div class="selected-main-row selected-main-row--summary">
        <input type="checkbox" class="country-toggle" data-country="${code}" ${countryVisibility[code] !== false ? "checked" : ""}>
        <span class="country-label">
          ${flagClass ? `<span class="country-flag ${flagClass}" aria-hidden="true"></span>` : ""}
          <span class="selected-main-label">${code}</span>
        </span>
        <span class="genre-count">${formatVisibleTotalCount(visibleCount, totalCount)}</span>
      </div>
    `;

    const onlySelected = isOnlyVisibleSelected(countryVisibility, code);
    const onlyLabel = onlySelected ? "Show all" : "Show only";

    const infoBodyHtml = `
      <button type="button" class="selected-only-toggle" data-only-type="country" data-country="${code}">${onlyLabel}</button>
      <p>Songs featuring artists from ${code}.</p>
      ${buildTopSongsSectionHtmlForItem(countrySongsAll, {
        resolveSides: (song) => getSongSidesContainingCountry(song, code)
      })}
    `;

    renderAccordionCell("#info-cell", {
      key: "selected",
      title: "",
      headerMetaHtml,
      bodyHtml: infoBodyHtml
    });

    if (resetScroll) scrollLeftPanelToTop();

    bindGenreClicks();

    d3.select("#info-cell").selectAll(".selected-only-toggle").on("click", handleSelectedOnlyToggleButtonClick);

    bindTopSongButtons("#info-cell");
    bindTopSongsModeDropdown("#info-cell");
  }

  function showArtistPanel(artistName, resetScroll = true, forceOpen = true) {
    closeSongAccordion();
    if (forceOpen) accordionState.selected = true;
    const name = String(artistName || "").trim();
    if (!name) return;

    currentPanel = { type: "artist", key: name };

    if (d3.select(".context-column").classed("empty")) {
      d3.select(".context-column").classed("empty", false);
    }

    const artistSongsAll = songs.filter(s => {
      const artists = s?.artists;
      if (Array.isArray(artists)) return artists.includes(name);
      if (typeof artists === "string") return artists === name;
      return false;
    });

    const totalCount = artistSongsAll.length;
    const visibleCount = visibleSongCountsCache.artists[name] || 0;

    const headerMetaHtml = `
      <div class="selected-main-row selected-main-row--summary">
        <input type="checkbox" class="artist-toggle" data-artist="${name}" ${artistVisibility[name] !== false ? "checked" : ""}>
        <span class="selected-main-label">${name}</span>
        <span class="genre-count">${formatVisibleTotalCount(visibleCount, totalCount)}</span>
      </div>
    `;

    const onlySelected = isOnlyVisibleSelected(artistVisibility, name);
    const onlyLabel = onlySelected ? "Show all" : "Show only";

    const infoBodyHtml = `
      <button type="button" class="selected-only-toggle" data-only-type="artist" data-artist="${name}">${onlyLabel}</button>
      <p>Songs by ${name}.</p>
      ${buildTopSongsSectionHtmlForItem(artistSongsAll, {
        resolveSides: (song) => getSongSidesContainingArtist(song, name)
      })}
    `;

    renderAccordionCell("#info-cell", {
      key: "selected",
      title: "",
      headerMetaHtml,
      bodyHtml: infoBodyHtml
    });

    if (resetScroll) scrollLeftPanelToTop();

    bindGenreClicks();

    d3.select("#info-cell").selectAll(".selected-only-toggle").on("click", handleSelectedOnlyToggleButtonClick);

    bindTopSongButtons("#info-cell");
    bindTopSongsModeDropdown("#info-cell");
  }

  });
// Menu overlay open/close logic with icon animation
(function() {
document.addEventListener('DOMContentLoaded', function() {
const menuBtn = document.getElementById('menu-toggle');
const menuOverlay = document.getElementById('menu-overlay');
if (!menuBtn || !menuOverlay) return;

let showMenu = false;

function setMenuOpen(nextOpen, { resetScroll = true } = {}) {
  if (nextOpen === showMenu) return;

  if (nextOpen) {
    menuOverlay.style.display = 'flex';

    if (resetScroll) {
      const panel = document.querySelector(".menu-overlay-panel");
      if (panel) panel.scrollTop = 0;
      const contextScroller = document.querySelector(".menu-overlay-panel .context-column");
      if (contextScroller) contextScroller.scrollTop = 0;
    }

    menuBtn.classList.add('open');
    menuBtn.setAttribute('aria-label', 'Close menu');
    document.body.classList.add('no-scroll');
    showMenu = true;
    return;
  }

  menuOverlay.style.display = 'none';
  menuBtn.classList.remove('open');
  menuBtn.setAttribute('aria-label', 'Open menu');
  document.body.classList.remove('no-scroll');
  showMenu = false;
}

// Allow the chart to open/close the menu overlay on mobile.
window.__goaSetMenuOpen = (open, opts) => setMenuOpen(!!open, opts);

menuBtn.addEventListener('click', function() {
  setMenuOpen(!showMenu);

});

menuOverlay.addEventListener('click', function(e) {
  if (e.target === menuOverlay) setMenuOpen(false);
});

    // Reset scroll when clicking a selected genre inside overlay
    overlayPanel.addEventListener('click', function(e) {
      // target a selected genre button
      if (e.target.matches('.clickable-genre, .clickable-descriptor, .clickable-taxonomy, .clickable-country, .clickable-artist')) {
        overlayPanel.scrollTop = 0; // reset scroll
        const contextScroller = document.querySelector(".menu-overlay-panel .context-column");
        if (contextScroller) contextScroller.scrollTop = 0;
      }
    });

});

  const contextColumn = document.querySelector(".context-column");
const overlayPanel = document.querySelector(".menu-overlay-panel");
const mainContainer = document.querySelector(".main-container");
const songCount = document.getElementById("song-count");
const songCountChartHost = document.getElementById("song-count-host");
const songCountOverlayHost = document.getElementById("song-count-overlay-host");

function moveContextColumn() {
  const isMobile = window.innerWidth <= 1100;
  if (isMobile) {
    if (!overlayPanel.contains(contextColumn)) {
      overlayPanel.appendChild(contextColumn);
    }
  } else {
    if (!mainContainer.contains(contextColumn)) {
      mainContainer.insertBefore(contextColumn, mainContainer.firstChild);
    }
  }

  // On mobile, keep the "Showing X songs" control inside the overlay, not in the chart header row.
  if (songCount && songCountChartHost && songCountOverlayHost) {
    const targetHost = isMobile ? songCountOverlayHost : songCountChartHost;
    if (!targetHost.contains(songCount)) targetHost.appendChild(songCount);
  }

  // Ensure the overlay can't remain open when switching back to desktop layout.
  if (!isMobile && typeof window.__goaSetMenuOpen === "function") {
    window.__goaSetMenuOpen(false, { resetScroll: false });
  }
}

window.addEventListener("resize", moveContextColumn);
window.addEventListener("DOMContentLoaded", moveContextColumn);
})();
