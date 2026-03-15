d3.json("./songs.json").then(dataset => {
  const songs = dataset.songs;
  const taxonomy = dataset.taxonomy || {};
  const genres = dataset.genres || {};

  let currentSongList = [];
  let sortMode = "chart"; // chart
  let currentPanel = { type: null, key: null };
  let genreSortMode = "popular"; // az, za, popular, unpopular
  let countrySortMode = "popular";  // az, za, popular, unpopular
  let artistSortMode = "popular";
  let selectedYear = null;
  let selectedRank = null;
  let genreListView = "organized"; // "all" or "organized"
  let organizedGroupState = {};
  let selectedSongIndex = -1;
  let selectedSongRef = null;
  let selectedSongSide = "A";
  let isCurrentVideoPlaying = false;
  let youtubeMessageListenerBound = false;
  let songTitleFitResizeBound = false;
  let songTitleFitResizeRaf = 0;
  let songTitleMaxRenderedHeight = 0;
  const accordionState = {
    song: true,
    selected: true,
    genres: false,
    categories: false,
    countries: false,
    artists: false,
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
    if (s.primarygenre) allGenresSet.add(s.primarygenre);
    if (Array.isArray(s.subgenres)) s.subgenres.forEach(g => allGenresSet.add(g));
  });
  const allGenresList = Array.from(allGenresSet).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  // Count genres
  let genreCounts = {};
  songs.forEach(s => {
    [s.primarygenre, ...(s.subgenres || [])].forEach(g => {
      if (!g) return;
      genreCounts[g] = (genreCounts[g] || 0) + 1;
    });
  });
  
  // Track visibility for genres - default to SHOWN (true)
  let genreVisibility = {};
  allGenresList.forEach(g => { genreVisibility[g] = true; }); /* default shown */

  let taxonomyVisibility = {};
  Object.keys(taxonomy).forEach(t => { taxonomyVisibility[t] = true; }); /* default shown */

  // Track visibility for countries and artists
  let countryVisibility = {};
  let artistVisibility = {};
  songs.forEach(s => {
    (s.countryCode || []).forEach(c => { countryVisibility[c] = true; });
    (s.artists || []).forEach(a => { artistVisibility[a] = true; });
  });

  // Tooltip
  const tooltip = d3.select("body").append("div").attr("id", "tooltip");
  let activeTooltipCell = null;
  let tooltipRepositionRaf = 0;

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

  // Taxonomy badges in header (desktop) and above chart (mobile)
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
      showSongModal(targetSongIndex, "A", false, true, true);
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
        showSongModal(selectedVisibleSongIndex, "A", true, true);
        return;
      }
    }

    const firstVisibleSongIndex = currentSongList.indexOf(visibleSongs[0]);
    if (firstVisibleSongIndex !== -1) {
      showSongModal(firstVisibleSongIndex, "A", true, true);
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

      const interactiveTarget = event.target.closest("button, input, a, label, .clickable-genre, .clickable-taxonomy");
      if (interactiveTarget) return;

      const nowOpen = !accordionState[panelKey];
      setPanelOpenState(panel, panelKey, nowOpen);
    });

    updateContextColumn();
  }
  function updateStatusBar() {
    const visibleCount = getVisibleSongs().length;
    const genreCount = Object.values(genreVisibility).filter(v => v).length;
    const taxonomyCount = Object.values(taxonomyVisibility).filter(v => v).length;
    const countryCount = Object.values(countryVisibility).filter(v => v).length;
    const artistCount = Object.values(artistVisibility).filter(v => v).length;
    const totalGenres = Object.keys(genreVisibility).length;
    const totalTaxonomies = Object.keys(taxonomyVisibility).length;
    const totalCountries = Object.keys(countryVisibility).length;
    const totalArtists = Object.keys(artistVisibility).length;

    const genreCountText = totalGenres > 0 && genreCount === totalGenres ? `${genreCount} (All)` : `${genreCount}`;
    const taxonomyAllEffective = totalTaxonomies > 0 && (taxonomyCount === 0 || taxonomyCount === totalTaxonomies);
    const countryAllEffective = totalCountries > 0 && (countryCount === 0 || countryCount === totalCountries);
    const artistAllEffective = totalArtists > 0 && (artistCount === 0 || artistCount === totalArtists);
    const taxonomyCountText = taxonomyAllEffective ? `${totalTaxonomies} (All)` : `${taxonomyCount}`;
    const countryCountText = countryAllEffective ? `${totalCountries} (All)` : `${countryCount}`;
    const artistCountText = artistAllEffective ? `${totalArtists} (All)` : `${artistCount}`;
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
                       Object.values(countryVisibility).every(v => v) &&
                       Object.values(artistVisibility).every(v => v);
    const newState = !allChecked;

    // "Show all" should also clear chart year/rank filters.
    if (newState) {
      selectedYear = null;
      selectedRank = null;
    }

    Object.keys(genreVisibility).forEach(k => genreVisibility[k] = newState);
    Object.keys(taxonomyVisibility).forEach(k => taxonomyVisibility[k] = newState);
    Object.keys(countryVisibility).forEach(k => countryVisibility[k] = newState);
    Object.keys(artistVisibility).forEach(k => artistVisibility[k] = newState);
    d3.selectAll(".genre-toggle, .taxonomy-toggle, .country-toggle, .artist-toggle").property("checked", newState);
    renderChartRankHeader();
    buildTable();
    rerenderCurrentPanel(false);
    updateStatusBar();
  }
  function getChartScrollContainer() {
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
    if (window.matchMedia("(max-width: 800px)").matches) return;

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
  [renderGenreListCell, renderCategoriesPanel, renderCountriesPanel, renderArtistsPanel, renderAboutPanel].forEach((renderFn) => {
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
    updateStatusBar();
    updateContextColumn();
    syncYearLabelText();
  }

// Genre Filtering
function isSongVisible(song) {
  const songGenres = [song.primarygenre, ...(song.subgenres || [])];
  const songCountries = song.countryCode || [];
  const songArtists = song.artists || [];

  const anyTaxChecked = Object.values(taxonomyVisibility).some(v => v);
  const anyGenreChecked = Object.values(genreVisibility).some(v => v);
  const anyCountryChecked = Object.values(countryVisibility).some(v => v);
  const anyArtistChecked = Object.values(artistVisibility).some(v => v);

  let genreOk = false;
  if (!anyTaxChecked) {
    genreOk = songGenres.some(g => genreVisibility[g]);
  } else {
    const taxOk = taxonomyVisibility[song.genretaxonomy];
    if (!anyGenreChecked && taxOk) genreOk = true;
    else genreOk = taxOk && songGenres.some(g => genreVisibility[g]);
  }

  // Country + artist filtering
  const countryOk = !anyCountryChecked || songCountries.some(c => countryVisibility[c]);
  const artistOk = !anyArtistChecked || songArtists.some(a => artistVisibility[a]);

  return genreOk && countryOk && artistOk;
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
    }
    // Tooltip 
    cell.on("mouseenter", function () {
      if (!song) return;
      let combinedTitle = song.tracks[0].title;
      if (song.tracks.length > 1 && song.tracks[1].title) combinedTitle += " / " + song.tracks[1].title;
      activeTooltipCell = this;
      tooltip.classed("visible", true).html(`
        <h2>${combinedTitle}</h2>
        <p class="tooltip-artist-line">${song.artists.join(" • ")}</p>
        <p class="tooltip-rank-genre-line">#${song.rank} for ${song.chartYear} • ${song.primarygenre}</p>
      `);
      syncTooltipMaxWidth(this);
      fitTooltipTextToWidth();
      positionTooltipForCell(this);
    })
    .on("mousemove", function() {
      if (!song) return;
      activeTooltipCell = this;
      queueTooltipReposition();
    })
    .on("mouseleave", function() {
      if (activeTooltipCell === this) activeTooltipCell = null;
      tooltip.classed("visible", false);
    })
    .on("click", () => {
      if (!song) return;
      let songIndex = currentSongList.indexOf(song);
      if (songIndex === -1) songIndex = currentSongList.findIndex(s => s.chartYear === song.chartYear && s.rank === song.rank);
      if (songIndex === -1) return;

      const isMobileOverlay = window.matchMedia && window.matchMedia("(max-width: 1100px)").matches;
      if (isMobileOverlay) {
        // Ensure the song accordion is opened when selecting from the chart on mobile.
        accordionState.song = true;
        if (typeof window.__goaSetMenuOpen === "function") {
          window.__goaSetMenuOpen(true);
        }
      }

      showSongModal(songIndex, "A", false, false, true);
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
  }


// panel tabs and open button removed; context cells will display information directly

function getToggleAllLabelFor(obj) {
  const allChecked = Object.values(obj).every(v => v);
  return allChecked ? "Hide all" : "Show all";
}

function syncToggleAllButtonLabels() {
  const allGlobalChecked = Object.values(genreVisibility).every(v => v) &&
                           Object.values(taxonomyVisibility).every(v => v) &&
                           Object.values(countryVisibility).every(v => v) &&
                           Object.values(artistVisibility).every(v => v);

  const allGenresChecked = Object.values(genreVisibility).every(v => v) &&
                           Object.values(taxonomyVisibility).every(v => v);

  d3.selectAll("#toggle-all-global, #toggle-all-global-overlay").text(allGlobalChecked ? "Hide all" : "Show all");
  d3.select("#toggle-all-genres").text(allGenresChecked ? "Hide all" : "Show all");
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
    JAMACIA: "JM",
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
    <div class="panel-controls-row">
      <button id="toggle-all-categories">${toggleAllLabel}</button>
    </div>
    <br>
    <ul>
      ${orderedKeys.map(tKey => {
        const info = taxonomy[tKey] || {};
        const label = info.label || tKey;
        const count = songs.filter(s => s.genretaxonomy === tKey).length;
        return `
          <li>
            <input type="checkbox" class="taxonomy-toggle" data-taxonomy="${tKey}" ${taxonomyVisibility[tKey] !== false ? "checked" : ""}>
            <span class="genre-badge clickable-taxonomy" data-taxonomy="${tKey}" style="${getTaxonomyBadgeStyle(info.color || "")}">${label}</span>
            <span class="genre-count">${count}</span>
          </li>
        `;
      }).join("")}
    </ul>
  `;

  renderAccordionCell("#categories-cell", {
    key: "categories",
    title: "Categories",
    bodyHtml: categoriesBodyHtml
  });

  d3.select("#toggle-all-categories").on("click", () => {
    const currentlyAllChecked = Object.values(taxonomyVisibility).every(v => v);
    const newState = !currentlyAllChecked;
    Object.keys(taxonomyVisibility).forEach(k => { taxonomyVisibility[k] = newState; });
    d3.selectAll(".taxonomy-toggle").property("checked", newState);
    d3.select("#toggle-all-categories").text(newState ? "Hide all" : "Show all");
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
    <div class="panel-controls-row">
      <button id="toggle-all-countries">${getToggleAllLabelFor(countryVisibility)}</button>
      ${renderSortDropdownHtml("countries", countrySortMode)}
    </div>
    <br>
    <ul>
      ${sorted.map(([c,count]) => {
        const flagClass = getFlagIconClass(c);
        return `
        <li>
          <input type="checkbox" class="country-toggle" data-country="${c}" ${countryVisibility[c] ? "checked" : ""}>
          <span class="country-label">
            ${flagClass ? `<span class="country-flag ${flagClass}" aria-hidden="true"></span>` : ""}
            <span>${c}</span>
          </span>
          <span class="genre-count">${count}</span>
        </li>`;
      }).join("")}
    </ul>
  `;

  renderAccordionCell("#countries-cell", {
    key: "countries",
    title: "Countries",
    bodyHtml: countriesBodyHtml
  });

  d3.selectAll(".country-toggle").on("change", function() {
    const c = d3.select(this).attr("data-country");
    countryVisibility[c] = this.checked;
    buildTable();
  });
  updateContextColumn();
  // Toggle all countries
d3.select("#toggle-all-countries").on("click", () => {
  const allChecked = Object.values(countryVisibility).every(v => v);
  const newState = !allChecked;
  Object.keys(countryVisibility).forEach(k => countryVisibility[k] = newState);
  d3.selectAll(".country-toggle").property("checked", newState);
  d3.select("#toggle-all-countries").text(getToggleAllLabelFor(countryVisibility));
  buildTable();
});
  bindSortDropdown(
    "countries",
    () => countrySortMode,
    (mode) => { countrySortMode = mode; },
    renderCountriesPanel
  );
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
    <div class="panel-controls-row">
      <button id="toggle-all-artists">${getToggleAllLabelFor(artistVisibility)}</button>
      ${renderSortDropdownHtml("artists", artistSortMode)}
    </div>
    <br>
    <ul>
      ${sorted.map(([a,count]) => `
        <li>
          <input type="checkbox" class="artist-toggle" data-artist="${a}" ${artistVisibility[a] ? "checked" : ""}>
          <span>${a}</span> <span class="genre-count">${count}</span>
        </li>`).join("")}
    </ul>
  `;

  renderAccordionCell("#artists-cell", {
    key: "artists",
    title: "Artists",
    bodyHtml: artistsBodyHtml
  });

  d3.selectAll(".artist-toggle").on("change", function() {
    const a = d3.select(this).attr("data-artist");
    artistVisibility[a] = this.checked;
    buildTable();
  });
  updateContextColumn();
// Toggle all Artists

d3.select("#toggle-all-artists").on("click", () => {
  const allChecked = Object.values(artistVisibility).every(v => v);
  const newState = !allChecked;
  Object.keys(artistVisibility).forEach(k => artistVisibility[k] = newState);
  d3.selectAll(".artist-toggle").property("checked", newState);
  d3.select("#toggle-all-artists").text(getToggleAllLabelFor(artistVisibility));
  buildTable();
});
  bindSortDropdown(
    "artists",
    () => artistSortMode,
    (mode) => { artistSortMode = mode; },
    renderArtistsPanel
  );
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
      <p>Genres of Australia is an interactive data visualisation of the top 10 singles on Australian charts for each year from 1954 to 2024.</p>
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
      <p>Sub genres for each single are ordered left to right from most to least influential, and take into account both the A and B side</p>
      <br>
      <br>
      <h2>Chart Data</h2>
      <br>
      <p>Data was sourced from The Kent Music Report (1954–1988) and ARIA (1988–2024):</p>
      <br>
      <p><a target="_blank"  href="https://www.aria.com.au/charts/2024/singles-chart">ARIA year end charts</a></p>
      <br>
      <p><a target="_blank"  href="https://australian-charts.com/search.asp?cat=s&search=">Australian Chart Archives</a></p>
      <br>
      <br>
      <h2>Genre Data</h2>
      <br>
      <p>Genre information was sourced from aggregate and user-voted websites:</p>
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

    selectedSongSide = hasSecondTrack && side === "B" ? "B" : "A";
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
    const genreSpans = [song.primarygenre, ...(song.subgenres || [])]
      .map(g => `<span class="clickable-genre" data-genre="${g}">${g}</span>`)
      .join(" • ");
    const artistCountryPairsHtml = (song.artists || [])
      .map((artist, index) => {
        const countries = song.countryCode || [];
        const country = countries[index] || (countries.length === 1 ? countries[0] : "");
        const flagClass = country ? getFlagIconClass(country) : "";
        const flagHtml = flagClass
          ? `<span class="country-flag ${flagClass}" title="${country}" aria-label="${country}" role="img"></span>`
          : "";

        return `<span class="artist-country-pair"><span class="artist-name">${artist}</span>${flagHtml}</span>`;
      })
      .join(" • ");
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
      </div>
    `;

    const songSummaryHtml = `
      <div class="song-compact-meta">
        <span class="song-compact-title">${selectedSideTitle}</span>
        <span class="song-compact-artist">${song.artists.join(" • ")}</span>
      </div>
      <div class="song-compact-controls">
        ${hasSecondTrack ? `<button id="compact-toggle-side" title="Toggle side">${currentSideOrVersionLabel}</button>` : ""}
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

    if (hasSecondTrack) {
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

    const groupGenres = grouped[group]
      .sort((a, b) => {
        const [aKey, aInfo] = a;
        const [bKey, bInfo] = b;
        const aLabel = getGenreLabel(aKey, aInfo);
        const bLabel = getGenreLabel(bKey, bInfo);
        return aLabel.localeCompare(bLabel);
      })
      .map(([gKey, g]) => {
        const count = genreCounts[gKey] || 0; // show how many songs that genre has
        return `
          <li class="genre-item" style="display:flex; align-items:center; gap:6px; margin:4px 0;">
            <input type="checkbox" class="genre-toggle" data-genre="${gKey}" ${genreVisibility[gKey] !== false ? "checked" : ""}>
            <span class="clickable-genre" data-genre="${gKey}">
              ${getGenreLabel(gKey, g)}
            </span>
            <span class="genre-count">${count}</span>
          </li>`;
      }).join("");

    return `
      <div class="organized-group ${isOpen ? "is-open" : "is-closed"}" data-organized-group="${group}">
        <button type="button" class="organized-group-toggle" data-organized-group="${group}" aria-expanded="${isOpen ? "true" : "false"}">
          <span class="organized-group-title">${group}</span>
          <span class="organized-group-arrow">&#x203A;</span>
        </button>
        <div class="organized-group-body">
          <ul>${groupGenres}</ul>
        </div>
      </div>
    `;
  }).join("");
}


  
function renderAllGenresList() {
  let sorted = [...allGenresList];

  if (genreSortMode === "az") {
    sorted.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  } else if (genreSortMode === "za") {
    sorted.sort((a, b) => b.toLowerCase().localeCompare(a.toLowerCase()));
  } else if (genreSortMode === "popular") {
    sorted.sort((a, b) => {
  const diff = (genreCounts[b] || 0) - (genreCounts[a] || 0);
  if (diff !== 0) return diff; // primary: popularity
  return a.toLowerCase().localeCompare(b.toLowerCase()); // secondary: A-Z
});
  } else if (genreSortMode === "unpopular") {
    sorted.sort((a, b) => {
  const diff = (genreCounts[a] || 0) - (genreCounts[b] || 0);
  if (diff !== 0) return diff; // primary: least popular
  return a.toLowerCase().localeCompare(b.toLowerCase()); // secondary: A-Z
});
  }

  return sorted.map(gKey => {
    const manual = genres[gKey];
    const count = genreCounts[gKey] || 0;
    return `<li>
      <input type="checkbox" class="genre-toggle" data-genre="${gKey}" ${genreVisibility[gKey] !== false ? "checked" : ""}>
      <span class="clickable-genre" data-genre="${gKey}">${manual ? manual.label : gKey}</span>
      <span class="genre-count">${count}</span>
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

  const genresBodyHtml = `
     <div class="panel-controls-row">${viewButtonHtml}
       <button id="toggle-all-genres">${toggleAllLabel}</button>
       ${sortButtonHtml}
     </div>
    <br>
     ${listContainer}
  `;

  renderAccordionCell("#genres-cell", {
    key: "genres",
    title: "Genres",
    bodyHtml: genresBodyHtml
  });
  bindGenreViewDropdown();

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

  d3.selectAll(".organized-group-toggle").on("click", function() {
    const group = d3.select(this).attr("data-organized-group");
    organizedGroupState[group] = !organizedGroupState[group];
    const container = d3.select(this.closest(".organized-group"));
    setOrganizedGroupState(container, organizedGroupState[group]);
  });
  
  bindGenreClicks();
  updateContextColumn();
  d3.select("#toggle-all-genres").on("click", function() {
      const allChecked = Object.values(genreVisibility).every(v => v);
      const newState = !allChecked;
      Object.keys(genreVisibility).forEach(k => { genreVisibility[k] = newState; });
      Object.keys(taxonomyVisibility).forEach(t => { taxonomyVisibility[t] = newState; });
      d3.selectAll(".genre-toggle").property("checked", newState);
      d3.selectAll(".taxonomy-toggle").property("checked", newState);
      buildTable();
      rerenderCurrentPanel(false);
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

  function bindGenreClicks() {
    d3.selectAll(".clickable-genre").on("click", function() {
      closeSongAccordion();
      showGenrePanel(d3.select(this).attr("data-genre"), true);
    });

    d3.selectAll(".clickable-taxonomy").on("click", function() {
      showTaxonomyPanel(d3.select(this).attr("data-taxonomy"), true);
    });

    d3.selectAll(".genre-toggle").on("change", function() {
      const gKey = d3.select(this).attr("data-genre");
      genreVisibility[gKey] = this.checked;
      d3.selectAll(`.genre-toggle[data-genre="${gKey}"]`).property("checked", this.checked);
      buildTable();
      rerenderCurrentPanel(false);
    });

    d3.selectAll(".taxonomy-toggle").on("change", function() {
      const tKey = d3.select(this).attr("data-taxonomy");
      taxonomyVisibility[tKey] = this.checked;
      d3.selectAll(`.taxonomy-toggle[data-taxonomy="${tKey}"]`).property("checked", this.checked);
      buildTable();
      rerenderCurrentPanel(false);
    });

}
// Taxonomy side panel
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
          const count = genreCounts[r] || 0;
          return `
            <li>
              <input type="checkbox" class="genre-toggle" data-genre="${r}" ${genreVisibility[r] !== false ? "checked" : ""}>
              <span class="clickable-genre" data-genre="${r}">${g ? g.label : r}</span> <span class="genre-count">${count}</span>
            </li>
          `;
        }).join("")
      : "";

    const relatedSectionHtml = relatedHtml ? `<h2>Key Genres:</h2><br><ul>${relatedHtml}</ul>` : "";
    const taxonomyCount = songs.filter(s => s.genretaxonomy === taxKey).length;

    const headerMetaHtml = `
      <div class="selected-main-row selected-main-row--summary">
        <input type="checkbox" class="taxonomy-toggle" data-taxonomy="${taxKey}" ${taxonomyVisibility[taxKey] !== false ? "checked" : ""}>
        <span class="genre-badge" style="${getTaxonomyBadgeStyle(info.color)}">${info.label}</span>
        <span class="genre-count">${taxonomyCount}</span>
      </div>
    `;

    const infoBodyHtml = `
      <p>${info.description || ""}</p>
      <br>
      ${relatedSectionHtml}
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
      const headerMetaHtml = `
        <div class="selected-main-row selected-main-row--summary">
          <input type="checkbox" class="genre-toggle" data-genre="${resolvedKey}" ${genreVisibility[resolvedKey] !== false ? "checked" : ""}>
          <span class="selected-main-label">${resolvedKey}</span>
          <span class="genre-count">${genreCounts[resolvedKey] || 0}</span>
        </div>
      `;

      const infoBodyHtml = `
        <p>No info on this genre.</p>
      `;

      renderAccordionCell("#info-cell", {
        key: "selected",
        title: "",
        headerMetaHtml,
        bodyHtml: infoBodyHtml
      });

      if (resetScroll) scrollLeftPanelToTop();
      bindGenreClicks();
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
            <span class="clickable-genre" data-genre="${r}">${genres[r]?.label || r}</span> <span class="genre-count">${genreCounts[r] || 0}</span>
          </li>
        `).join("")
      : "";

    const relatedSectionHtml = relatedHtml ? `<h2>Related genres:</h2><br><ul>${relatedHtml}</ul>` : "";

    const headerMetaHtml = `
      <div class="selected-main-row selected-main-row--summary">
        <input type="checkbox" class="genre-toggle" data-genre="${resolvedKey}" ${genreVisibility[resolvedKey] !== false ? "checked" : ""}>
        <span class="selected-main-label">${g.label}</span>
        <span class="genre-count">${genreCounts[resolvedKey] || 0}</span>
      </div>
    `;

    const infoBodyHtml = `
      <div>${taxBadge}</div>
      <br>
      <p>${g.description || ""}</p>
      <br>
      ${g.link ? `<p><a href="${g.link}" target="_blank">Learn more <span aria-hidden="true">🡥</span></a></p>` : ""}
      <br>
      ${relatedSectionHtml}
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
      if (e.target.matches('.clickable-genre, .clickable-taxonomy')) {
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
