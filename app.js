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
  let sortGenresByVisible = false;
  let sortDescriptorsByVisible = false;
  let sortCountriesByVisible = false;
  let sortArtistsByVisible = false;
  let selectedYear = [];
  let selectedRank = [];
  let genreListView = "organized"; // "all" or "organized"
  let organizedGroupState = {};
  let descriptorListView = "organized"; // "all" or "organized"
  let organizedDescriptorGroupState = {};
  let organizedDescriptorSubgroupState = {};
  let mustContainAllSelectedGenres = false;
  let mustContainAllSelectedDescriptors = false;
  let showAllExcludingSelectedGenres = false;
  let showAllExcludingSelectedDescriptors = false;
  let selectedSongIndex = -1;
  let selectedSongRef = null;
  let selectedSongSide = "A";
  let selectedSongVariant = "chart";
  let isCurrentVideoPlaying = false;
  let youtubeMessageListenerBound = false;
  let currentVideoTime = 0;
  let currentVideoDuration = 0;
  let isVideoScrubbing = false;
  let ratingMinFilter = 0.5;
  let ratingMaxFilter = 5;
  let lastClickedHistogramBin = null;
  let lastClickedYearFilter = null;
  let lastClickedRankFilter = null;
  const accordionState = {
    song: true,
    genres: false,
    descriptors: false,
    categories: false,
    countries: false,
    artists: false,
    ratings: false,
    about: false
  };

  const panelSelectedState = {
    genres: null,
    descriptors: null,
    categories: null,
    countries: null,
    artists: null
  };

  function getPanelForSelectionType(type) {
    if (type === "taxonomy") return "categories";
    if (type === "genre") return "genres";
    if (type === "descriptor") return "descriptors";
    if (type === "country") return "countries";
    if (type === "artist") return "artists";
    return null;
  }

  function renderPanelSelectedBlockHtml(panelKey) {
    const state = panelSelectedState[panelKey];
    if (!state) return "";

    const cardAccentStyle = state.headerBorderColor
      ? ` style="${getTaxonomyContainerAccentStyle(state.headerBorderColor)}"`
      : "";

    return `
      <div class="panel-selected" data-panel-selected="${panelKey}"${cardAccentStyle}>
        <div class="panel-selected-header">
          <div class="panel-selected-header-meta">
            ${state.headerMetaHtml || ""}
          </div>
          <button type="button" class="panel-selected-close" data-panel-selected-close="${panelKey}" aria-label="Close selected">
            <span class="close-icon-mask" aria-hidden="true"></span>
          </button>
        </div>
        <div class="panel-selected-body">
          ${state.bodyHtml || ""}
        </div>
      </div>
    `;
  }

  function bindPanelSelectedBlockInteractions(panelKey, { rerender, containerSelector }) {
    const container = d3.select(containerSelector);
    if (container.empty()) return;

    container.selectAll(`[data-panel-selected-close="${panelKey}"]`).on("click", function(event) {
      event.preventDefault();
      event.stopPropagation();

      panelSelectedState[panelKey] = null;
      if (getPanelForSelectionType(currentPanel.type) === panelKey) currentPanel = { type: null, key: null };

      if (typeof rerender === "function") rerender();
      updateContextColumn();
    });

    container.selectAll(".selected-only-toggle").on("click", handleSelectedOnlyToggleButtonClick);
    bindTopSongButtons(containerSelector);
    bindTopSongsModeDropdown(containerSelector);
  }

  const years = Array.from(new Set(songs.map(d => d.chartYear))).sort((a, b) => a - b);
  const maxRankInData = Math.max(
    10,
    d3.max(songs, d => Number(d?.rank)) || 0
  );
  let ranks = d3.range(1, maxRankInData + 1);
  selectedRank = selectedRank.filter(rank => rank <= maxRankInData);
  const taxonomyOrder = ["hiphop","dance","soulrnb","rock","countryfolk","jazztraditionalpop"];

  function hasSelectedValue(selectedValues, value) {
    return Array.isArray(selectedValues) && selectedValues.includes(value);
  }

  function hasAnySelectedValue(selectedValues) {
    return Array.isArray(selectedValues) && selectedValues.length > 0;
  }

  function addOrRepeatToggleSelectedValue(selectedValues, value, lastClickedValue) {
    const list = Array.isArray(selectedValues) ? selectedValues : [];
    const isSelected = list.includes(value);
    const repeatedClick = isSelected && lastClickedValue === value;
    return {
      values: repeatedClick
        ? []
        : (isSelected ? list : [...list, value].sort((a, b) => a - b)),
      lastClicked: repeatedClick ? null : value
    };
  }

  function clearChartNumberFilters() {
    selectedYear = [];
    selectedRank = [];
    lastClickedYearFilter = null;
    lastClickedRankFilter = null;
  }

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

  const genreHasSongs = (gKey) => (genreCounts[gKey] || 0) > 0;
  
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

      getVisibleSongTaxonomies(song).forEach((t) => {
        taxonomyCounts[t] = (taxonomyCounts[t] || 0) + 1;
      });

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
  let activeTooltipMode = "chart";
  let tooltipRepositionRaf = 0;
  let chartTooltipDelayTimer = 0;
  let chartTooltipSuppressUntil = 0;
  const chartTooltipDelayMs = 0;

  function isMobileTooltipDisabled() {
    return window.matchMedia && window.matchMedia("(hover: none), (pointer: coarse), (max-width: 1100px)").matches;
  }

  function syncTooltipMaxWidth(cellNode) {
    const tooltipNode = tooltip.node();
    if (!tooltipNode) return;

    const boundsNode = (cellNode && cellNode.closest(".chart-grid-scroller")) || document.querySelector(".chart-grid-scroller");
    if (!boundsNode) {
      tooltip.style("max-width", "min(560px, calc(100vw - 20px))");
      return;
    }

    const boundsRect = boundsNode.getBoundingClientRect();
    if (boundsRect.width <= 0) {
      tooltip.style("max-width", "min(560px, calc(100vw - 20px))");
      return;
    }

    const gridInset = 12;
    const safeWidth = Math.max(220, Math.floor(boundsRect.width - (gridInset * 2)));
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
    if (activeTooltipMode === "chart" && (chartTooltipDelayTimer || !tooltip.classed("visible"))) return;
    if (tooltipRepositionRaf) cancelAnimationFrame(tooltipRepositionRaf);
    tooltipRepositionRaf = requestAnimationFrame(() => {
      tooltipRepositionRaf = 0;
      if (!activeTooltipCell || !activeTooltipCell.isConnected) return;
      fitTooltipTextToWidth();
      if (activeTooltipMode === "histogram") {
        positionTooltipForElement(activeTooltipCell);
      } else {
        syncTooltipMaxWidth(activeTooltipCell);
        positionTooltipForCell(activeTooltipCell);
      }
    });
  }

  function clearChartTooltipDelay() {
    if (!chartTooltipDelayTimer) return;
    clearTimeout(chartTooltipDelayTimer);
    chartTooltipDelayTimer = 0;
  }

  function hideChartTooltipForCell(cellNode = null) {
    clearChartTooltipDelay();
    if (!cellNode || activeTooltipCell === cellNode) activeTooltipCell = null;
    activeTooltipMode = "chart";
    tooltip.classed("visible", false);
  }

  function scheduleChartTooltip(cellNode, song) {
    if (!cellNode || !song) return;
    if (performance.now() < chartTooltipSuppressUntil) return;

    clearChartTooltipDelay();
    chartTooltipDelayTimer = setTimeout(() => {
      chartTooltipDelayTimer = 0;
      if (!cellNode.isConnected || activeTooltipCell !== cellNode) return;
      if (performance.now() < chartTooltipSuppressUntil) return;

      const hoverSide = getEffectiveVisibleSongSide(song);
      const track = hoverSide === "B" ? song.tracks?.[1] : song.tracks?.[0];
      const trackTitle = getFilteredHoverTitleForSong(song) || track?.title || song.tracks?.[0]?.title || "";
      const artistSeparator = getSongArtistSeparator(song);
      const filteredArtists = getFilteredHoverArtistsForSong(song);
      const sideGenres = getSongGenresForSide(song, hoverSide);
      const sideGenreList = [sideGenres.primarygenre, ...(sideGenres.subgenres || [])].filter(Boolean);
      const genreLabel = sideGenreList.find(g => genreVisibility[g]) || sideGenres.primarygenre || song.primarygenre || "";

      tooltip.html(`
        <h2>${trackTitle}</h2>
        <p class="tooltip-artist-line">${filteredArtists.join(artistSeparator)}</p>
        <p class="tooltip-rank-genre-line">#${song.rank} for ${song.chartYear} &bull; ${genreLabel}</p>
      `);
      syncTooltipMaxWidth(cellNode);
      fitTooltipTextToWidth();
      positionTooltipForCell(cellNode);
    }, chartTooltipDelayMs);
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

    const boundsNode = cellNode.closest(".chart-grid-scroller") || cellNode.closest(".chart-table") || document.querySelector(".chart-grid-scroller") || document.querySelector(".chart-table");
    if (!boundsNode) {
      tooltip.classed("visible", false);
      return;
    }

    const boundsRect = boundsNode.getBoundingClientRect();
    if (boundsRect.width <= 0 || boundsRect.height <= 0) {
      tooltip.classed("visible", false);
      return;
    }

    const gridLeft = scrollX + boundsRect.left;
    const gridTop = scrollY + boundsRect.top;
    const gridRight = scrollX + boundsRect.right;
    const gridBottom = scrollY + boundsRect.bottom;

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

  function positionTooltipForElement(anchorNode) {
    const tooltipNode = tooltip.node();
    if (!tooltipNode || !anchorNode) return;

    const rect = anchorNode.getBoundingClientRect();
    const gap = 8;
    const viewportPadding = 10;
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;
    const viewport = window.visualViewport;
    const viewportLeft = scrollX + (viewport ? viewport.offsetLeft : 0);
    const viewportTop = scrollY + (viewport ? viewport.offsetTop : 0);
    const viewportWidth = viewport ? viewport.width : window.innerWidth;
    const viewportHeight = viewport ? viewport.height : window.innerHeight;
    const tooltipWidth = tooltipNode.offsetWidth;
    const tooltipHeight = tooltipNode.offsetHeight;
    const anchorLeft = scrollX + rect.left;
    const anchorRight = scrollX + rect.right;
    const anchorTop = scrollY + rect.top;
    const anchorBottom = scrollY + rect.bottom;
    const anchorCenterX = (anchorLeft + anchorRight) / 2;

    const minLeft = viewportLeft + viewportPadding;
    const maxLeft = viewportLeft + viewportWidth - tooltipWidth - viewportPadding;
    const topAbove = anchorTop - tooltipHeight - gap;
    const topBelow = anchorBottom + gap;
    const maxTop = viewportTop + viewportHeight - tooltipHeight - viewportPadding;
    const left = Math.max(minLeft, Math.min(anchorCenterX - (tooltipWidth / 2), Math.max(minLeft, maxLeft)));
    const top = topAbove >= viewportTop + viewportPadding
      ? topAbove
      : Math.max(viewportTop + viewportPadding, Math.min(topBelow, maxTop));

    tooltip
      .classed("visible", true)
      .style("left", `${left}px`)
      .style("top", `${top}px`);
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

  function hexToRgba(hexColor, alpha) {
    const hex = String(hexColor || "").trim().replace("#", "");
    if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(hex)) return "";

    const expandedHex = hex.length === 3
      ? hex.split("").map(ch => ch + ch).join("")
      : hex;

    const r = parseInt(expandedHex.slice(0, 2), 16);
    const g = parseInt(expandedHex.slice(2, 4), 16);
    const b = parseInt(expandedHex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function getTaxonomyContainerAccentStyle(color) {
    const fill = hexToRgba(color, 0.1);
    if (!color) return "";
    return `border-color: ${color};${fill ? ` background-color: ${fill};` : ""}`;
  }

  function getTaxonomyBadgeStyle(color) {
    const safeColor = color || "#b6c5d5";
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
      return `<span class="play-icon-mask play-icon-mask--pause" aria-hidden="true"></span>`;
    }
    return `<span class="play-icon-mask play-icon-mask--play" aria-hidden="true"></span>`;
  }

  function getStepButtonIconSvg(direction) {
    if (direction === "prev") {
      return `<span class="play-icon-mask play-icon-mask--prev" aria-hidden="true"></span>`;
    }
    return `<span class="play-icon-mask play-icon-mask--next" aria-hidden="true"></span>`;
  }

  function getDropdownIconHtml() {
    return `<span class="dropdown-icon-mask" aria-hidden="true"></span>`;
  }

  function setCurrentVideoPlaying(nextPlaying) {
    isCurrentVideoPlaying = !!nextPlaying;
    const icon = getPlayButtonIconSvg(isCurrentVideoPlaying);
    const label = isCurrentVideoPlaying ? "Pause video" : "Play video";

    d3.selectAll(".song-compact-play-btn")
      .html(`<span class="play-icon">${icon}</span>`)
      .attr("title", null)
      .attr("aria-label", label);

    d3.selectAll(".context-nav-icon--song")
      .classed("is-playing", isCurrentVideoPlaying)
      .attr("title", null);
  }

  function formatVideoTime(seconds) {
    const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }
    return `${minutes}:${String(secs).padStart(2, "0")}`;
  }

  function syncSelectedSongScrubberUi({ force = false } = {}) {
    const duration = Number.isFinite(currentVideoDuration) && currentVideoDuration > 0 ? currentVideoDuration : 0;
    const current = Math.min(Math.max(0, currentVideoTime || 0), duration || Math.max(0, currentVideoTime || 0));

    d3.selectAll(".song-compact-scrub-current").text(formatVideoTime(current));
    d3.selectAll(".song-compact-scrub-duration").text(duration > 0 ? formatVideoTime(duration) : "0:00");

    d3.selectAll(".song-compact-scrub-input")
      .attr("max", duration > 0 ? duration : 0)
      .property("disabled", duration <= 0)
      .style("--scrub-progress", `${duration > 0 ? (current / duration) * 100 : 0}%`)
      .each(function() {
        if (!force && isVideoScrubbing && document.activeElement === this) return;
        d3.select(this).property("value", current);
      });
  }

  function updateVideoProgressFromPlayerInfo(info = {}) {
    if (typeof info.duration === "number" && Number.isFinite(info.duration)) {
      currentVideoDuration = Math.max(0, info.duration);
    }

    if (!isVideoScrubbing && typeof info.currentTime === "number" && Number.isFinite(info.currentTime)) {
      currentVideoTime = Math.max(0, info.currentTime);
    }

    syncSelectedSongScrubberUi();
  }

  function getCurrentVideoIframe() {
    return d3.select("#video-container iframe").node();
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

    if (payload.event === "infoDelivery" && payload.info) {
      updateVideoProgressFromPlayerInfo(payload.info);
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

  function seekCurrentVideoTo(seconds) {
    const iframe = getCurrentVideoIframe();
    if (!iframe || !iframe.contentWindow) return false;

    const target = Math.max(0, Math.min(Number(seconds) || 0, currentVideoDuration || Number(seconds) || 0));
    currentVideoTime = target;
    iframe.contentWindow.postMessage(
      JSON.stringify({ event: "command", func: "seekTo", args: [target, true] }),
      "*"
    );
    syncSelectedSongScrubberUi({ force: true });
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

    // Move to next/prev song - enter on A when stepping forward, B when stepping backward (if visible)
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
      // When stepping forward, enter a song on side A (if visible) so the next step can play side B.
      // When stepping backward, enter a song on side B (if visible) so the previous step can play side A.
      const preferredSide = step > 0 ? "A" : "B";
      const startingSide = targetVisibleSides.includes(preferredSide)
        ? preferredSide
        : (targetVisibleSides.includes(preferredSide === "A" ? "B" : "A") ? (preferredSide === "A" ? "B" : "A") : "A");
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
    const isRankFiltered = isChartSort && hasAnySelectedValue(selectedRank);
    const dataColumnCount = ranks.length;
    const ranksHtml = ranks.map(rank => {
      const isActive = isChartSort && hasSelectedValue(selectedRank, rank);
      const classes = ["chart-rank-label"];
      if (isChartSort) classes.push("chart-rank-label-toggle");
      if (isActive) classes.push("chart-rank-label-active");
      const label = isChartSort ? `#${rank}` : `${rank}`;
      const title = isActive
        ? (lastClickedRankFilter === rank ? "Reset rank filter" : `Rank #${rank} selected`)
        : `Add rank #${rank}`;

      return `<td class="${classes.join(" ")}" data-rank="${rank}" ${isChartSort ? `role="button" tabindex="0" aria-pressed="${isActive ? "true" : "false"}" title="${title}"` : ""}>${label}</td>`;
    }).join("");

    mount
      .style("display", null)
      .style("--chart-data-columns", dataColumnCount)
      .html(`
      <table class="chart-rank-table ${isRankFiltered ? "rank-filter-active" : ""}" style="--chart-data-columns: ${dataColumnCount};" aria-hidden="true">
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
          const nextSelection = addOrRepeatToggleSelectedValue(selectedRank, rank, lastClickedRankFilter);
          selectedRank = nextSelection.values;
          lastClickedRankFilter = nextSelection.lastClicked;
          renderChartRankHeader();
          buildTable();
        })
        .on("keydown", function(event) {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          const rank = Number(d3.select(this).attr("data-rank"));
          if (!Number.isFinite(rank)) return;
          const nextSelection = addOrRepeatToggleSelectedValue(selectedRank, rank, lastClickedRankFilter);
          selectedRank = nextSelection.values;
          lastClickedRankFilter = nextSelection.lastClicked;
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
          ${getChartSortModeText(currentMode)} ${getDropdownIconHtml()}
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
        if (sortMode === "genre") {
          selectedRank = [];
          lastClickedRankFilter = null;
        }
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
  const contextPanelDefs = [ 
    { key: "song", selector: "#song-modal-cell" }, 
    { key: "categories", selector: "#categories-cell" }, 
    { key: "genres", selector: "#genres-cell" }, 
    { key: "descriptors", selector: "#descriptors-cell" }, 
    { key: "countries", selector: "#countries-cell" }, 
    { key: "artists", selector: "#artists-cell" }, 
    { key: "ratings", selector: "#ratings-cell" }, 
    { key: "about", selector: "#about-cell" } 
  ]; 
  let activeContextPanelKey = "song"; 
 
  function isMobileOverlayMode() { 
    return !!(window.matchMedia && window.matchMedia("(max-width: 1100px)").matches); 
  } 
 
  function setActiveContextPanel(panelKey, { scrollToTop = true } = {}) { 
    if (!panelKey) return; 
    activeContextPanelKey = panelKey; 
 
    d3.selectAll(".context-nav-button").each(function() { 
      const btn = d3.select(this); 
      const isActive = btn.attr("data-panel") === activeContextPanelKey; 
      btn.classed("is-active", isActive); 
      btn.attr("aria-current", isActive ? "page" : null); 
    }); 
 
    contextPanelDefs.forEach(({ key, selector }) => { 
      const cell = d3.select(selector); 
      if (cell.empty()) return; 
      const isActive = key === activeContextPanelKey; 
      cell.style("display", isActive ? null : "none"); 
      cell.attr("aria-hidden", isActive ? "false" : "true"); 
      if (isActive && scrollToTop) { 
        const node = cell.node(); 
        if (node) node.scrollTop = 0; 
        const bodyNode = node.querySelector?.(".accordion-body");
        if (bodyNode) bodyNode.scrollTop = 0;
        if (isMobileOverlayMode()) {
          const overlayPanel = document.querySelector(".menu-overlay-panel");
          if (overlayPanel) overlayPanel.scrollTop = 0;
          const contextColumn = document.querySelector(".menu-overlay-panel .context-column");
          if (contextColumn) contextColumn.scrollTop = 0;
        }
      } 
    }); 
  } 
 
  function initContextSideNav() { 
    const nav = d3.select(".context-nav"); 
    if (nav.empty()) return; 
 
    d3.selectAll(".context-nav-button").on("click", function(event) { 
      event.preventDefault(); 
      event.stopPropagation(); 

      if (!isMobileOverlayMode() && event.target?.closest?.(".context-nav-icon--song")) {
        playSelectedVisibleSongFromChartControls();
        return;
      }

      const key = d3.select(this).attr("data-panel"); 
      setActiveContextPanel(key); 
      updateContextColumn(); 
    }); 
 
    // Ensure we re-apply the correct layout on resize (desktop <-> mobile). 
    window.addEventListener("resize", () => updateContextColumn()); 
  } 
 
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
    // Show only the active panel in both desktop and mobile-overlay layouts. 
    const activeDef = contextPanelDefs.find(d => d.key === activeContextPanelKey) || contextPanelDefs[0]; 
    if (activeDef) setActiveContextPanel(activeDef.key, { scrollToTop: false }); 
  } 

  window.__goaUpdateContextColumn = updateContextColumn;

  function openSelectedSongContextCell() {
    if (!selectedSongRef) return;

    accordionState.song = true;

    if (isMobileOverlayMode()) {
      setActiveContextPanel("song", { scrollToTop: false });
      if (typeof window.__goaSetMenuOpen === "function") {
        window.__goaSetMenuOpen(true);
      }
      updateContextColumn();
      return;
    }

    setActiveContextPanel("song");
    updateContextColumn();
  }

  function refreshRenderedContextPanels({ preserveScroll = true } = {}) {
    const desktopPanelsScroller = !isMobileOverlayMode() ? d3.select(".context-panels").node() : null;
    const priorDesktopPanelsScrollTop = preserveScroll ? (desktopPanelsScroller?.scrollTop || 0) : 0;

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
      const priorBodyScrollTop = preserveScroll ? (node.querySelector(".accordion-body")?.scrollTop || 0) : 0;
      try {
        render();
      } catch (error) {
        console.error("Panel refresh failed:", selector, error);
      }
      if (preserveScroll) {
        node.scrollTop = priorScrollTop;
        const nextBodyNode = node.querySelector(".accordion-body");
        if (nextBodyNode) nextBodyNode.scrollTop = priorBodyScrollTop;
      }
    });

    updateContextColumn();

    if (preserveScroll && desktopPanelsScroller) {
      const restoreSidebarScroll = () => {
        const maxTop = Math.max(0, desktopPanelsScroller.scrollHeight - desktopPanelsScroller.clientHeight);
        desktopPanelsScroller.scrollTop = Math.min(Math.max(0, priorDesktopPanelsScrollTop), maxTop);
      };
      restoreSidebarScroll();
      requestAnimationFrame(restoreSidebarScroll);
    }
  }

  function scrollLeftPanelToTop() {
    const contextColumnNode = d3.select(".context-column").node();
    if (contextColumnNode) contextColumnNode.scrollTop = 0;
  }

  function scrollContextPanelToTop(panelSelector = null) {
    const panelNode = panelSelector ? d3.select(panelSelector).node() : null;
    if (panelNode) panelNode.scrollTop = 0;

    const bodyNode = panelNode?.querySelector?.(".accordion-body");
    if (bodyNode) bodyNode.scrollTop = 0;

    if (!isMobileOverlayMode()) {
      const panelsScroller = d3.select(".context-panels").node();
      if (panelsScroller) panelsScroller.scrollTop = 0;
      return;
    }

    const overlay = document.querySelector("#menu-overlay");
    const overlayPanel = document.querySelector(".menu-overlay-panel");
    const contextColumn = document.querySelector(".menu-overlay-panel .context-column");
    const panelsScroller = document.querySelector(".menu-overlay-panel .context-panels");

    if (overlay) overlay.scrollTop = 0;
    if (overlayPanel) overlayPanel.scrollTop = 0;
    if (contextColumn) contextColumn.scrollTop = 0;
    if (panelsScroller) panelsScroller.scrollTop = 0;
    document
      .querySelectorAll(".menu-overlay-panel .accordion-body, .menu-overlay-panel .song-body-content")
      .forEach((node) => { node.scrollTop = 0; });
  }

  function queueContextPanelScrollToTop(panelSelector = null) {
    scrollContextPanelToTop(panelSelector);
    requestAnimationFrame(() => scrollContextPanelToTop(panelSelector));
    setTimeout(() => scrollContextPanelToTop(panelSelector), 0);
    setTimeout(() => scrollContextPanelToTop(panelSelector), 80);
  }

  window.__goaScrollContextPanelToTop = queueContextPanelScrollToTop;

  function closeSongAccordion(immediate = false) { 
    // Intentionally disabled: panels should not auto-close.
    void immediate;
    return;
  } 

  function renderAccordionCell(cellSelector, { key, title = "", headerMetaHtml = "", summaryHtml = "", bodyHtml = "", defaultOpen = true, headerBorderColor = "", showHeader = true }) { 
    const cell = d3.select(cellSelector); 
    if (!bodyHtml || !String(bodyHtml).trim()) { 
      cell.classed("context-cell--accordion", false); 
      cell.html(""); 
      updateContextColumn(); 
      return; 
    } 

    cell.classed("context-cell--accordion", true); 
 
    const useAccordionInteractions = false; 
    if (accordionState[key] === undefined) accordionState[key] = defaultOpen; 
    const isOpen = showHeader && useAccordionInteractions ? accordionState[key] : true; 
    const keepSummaryVisible = key === "song"; 
    const hasTitle = String(title).trim().length > 0; 
    const renderStaticPanelHeading = showHeader && key !== "song" && (hasTitle || headerMetaHtml);

    const titleButtonHtml = hasTitle
      ? `<button type="button" class="accordion-toggle accordion-toggle-title" data-accordion-key="${key}" aria-expanded="${isOpen ? "true" : "false"}">
            <span class="accordion-title">${title}</span>
         </button>`
      : "";

    const metaHtml = headerMetaHtml
      ? `<div class="accordion-title-meta">${headerMetaHtml}</div>`
      : "";

    const headerStyle = headerBorderColor
      ? ` style="${getTaxonomyContainerAccentStyle(headerBorderColor)}"`
      : "";

    const headerHtml = (showHeader && useAccordionInteractions)
      ? `
        <div class="accordion-header"${headerStyle}>
          ${titleButtonHtml}
          ${metaHtml}
          <div class="accordion-summary" style="display:${(isOpen && !keepSummaryVisible) ? "none" : "flex"};">
            ${summaryHtml || ""}
          </div>
          <button type="button" class="accordion-toggle accordion-toggle-arrow" data-accordion-key="${key}" aria-expanded="${isOpen ? "true" : "false"}">
            <span class="accordion-arrow" aria-hidden="true"></span>
          </button>
        </div>
      `
      : "";

    const panelHeadingHtml = renderStaticPanelHeading
      ? `
        <div class="panel-heading"${headerStyle}>
          ${hasTitle ? `<h2 class="panel-heading-title">${title}</h2>` : ""}
          ${headerMetaHtml ? `<div class="panel-heading-meta">${headerMetaHtml}</div>` : ""}
        </div>
      `
      : "";

    cell.html(`
      <div class="accordion-panel ${isOpen ? "is-open" : "is-closed"}" data-accordion-key="${key}">
        ${headerHtml}
        <div class="accordion-body">
          ${panelHeadingHtml}
          ${bodyHtml}
        </div>
      </div>
    `);

    function setPanelOpenState(panel, panelKey, nowOpen, immediate = false) {
      accordionState[panelKey] = nowOpen;
      const bodyNode = panel.select(".accordion-body").node();
      if (!bodyNode) return;
      const openDisplay = panelKey === "song" ? "flex" : "block";

      panel.classed("is-open", nowOpen).classed("is-closed", !nowOpen);
      panel.select(".accordion-summary").style("display", (nowOpen && !keepSummaryVisible) ? "none" : "flex");
      panel.selectAll(".accordion-toggle").attr("aria-expanded", nowOpen ? "true" : "false");

      if (immediate) {
        bodyNode.style.display = nowOpen ? openDisplay : "none";
        bodyNode.style.maxHeight = nowOpen ? "none" : "0px";
        bodyNode.style.opacity = nowOpen ? "1" : "0";
        bodyNode.style.paddingTop = nowOpen ? "12px" : "0px";
        return;
      }

      if (nowOpen) {
        bodyNode.style.display = openDisplay;
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
 
    if (useAccordionInteractions) { 
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
    } else { 
      // Desktop side-panel layout: keep panels always open (no accordion interactions). 
      accordionState[key] = true; 
    } 
 
    updateContextColumn(); 
  } 
  function updateStatusBar() {
    const visibleCount = visibleSongCountsCache.songs;

    const escapeHtml = (value) => String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

    const buildFilterRow = (iconKey, text) => `
      <div class="song-count-dropdown-row">
        ${iconKey === "categories"
          ? `<img src="SVG/Categories.svg" alt="" class="song-count-filter-icon song-count-filter-icon--image" aria-hidden="true">`
          : `<span class="song-count-filter-icon song-count-filter-icon--${iconKey}" aria-hidden="true"></span>`}
        <span class="song-count-filter-text">${text}</span>
      </div>
    `;

    const getActiveFilterSummary = (visibilityMap, totalLabel, iconKey, getDisplayLabel) => {
      const keys = Object.keys(visibilityMap || {});
      const total = keys.length;
      if (total === 0) return null;

      const selectedKeys = keys.filter(k => visibilityMap[k] !== false);
      if (selectedKeys.length === total) return null;

      const selectedText = selectedKeys.length > 3
        ? `${selectedKeys.length}/${total} ${totalLabel}`
        : (selectedKeys.length > 0
          ? selectedKeys.map(k => escapeHtml(getDisplayLabel(k))).join(", ")
          : `0/${total} ${totalLabel}`);

      return buildFilterRow(iconKey, selectedText);
    };

    const activeFilterRows = [];

    if (hasAnySelectedValue(selectedYear)) {
      const yearText = selectedYear.map(year => escapeHtml(year)).join(", ");
      activeFilterRows.push(`<div class="song-count-dropdown-row">Year: ${yearText}</div>`);
    }

    if (sortMode === "chart" && hasAnySelectedValue(selectedRank)) {
      const rankText = selectedRank.map(rank => `#${escapeHtml(rank)}`).join(", ");
      activeFilterRows.push(`<div class="song-count-dropdown-row">Rank: ${rankText}</div>`);
    }

    if (ratingMinFilter > 0.5 || ratingMaxFilter < 5) {
      const formatRatingFilter = (value) => {
        const v = Number(value);
        if (!Number.isFinite(v)) return "";
        return v.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
      };
      activeFilterRows.push(buildFilterRow("ratings", `Ratings: ${formatRatingFilter(ratingMinFilter)}-${formatRatingFilter(ratingMaxFilter)} stars`));
    }

    if (showAllExcludingSelectedGenres && getSelectedGenreKeys().length > 0) {
      activeFilterRows.push(buildFilterRow("genres", "Genres: excluding selected"));
    }

    if (showAllExcludingSelectedDescriptors && getSelectedDescriptorKeys().length > 0) {
      activeFilterRows.push(buildFilterRow("descriptors", "Descriptors: excluding selected"));
    }

    [
      getActiveFilterSummary(genreVisibility, "genres", "genres", k => genres[k]?.label || k),
      getActiveFilterSummary(descriptorVisibility, "descriptors", "descriptors", k => descriptors[k]?.label || k),
      getActiveFilterSummary(taxonomyVisibility, "categories", "categories", k => taxonomy[k]?.label || k),
      getActiveFilterSummary(countryVisibility, "countries", "countries", k => k),
      getActiveFilterSummary(artistVisibility, "artists", "artists", k => k)
    ].forEach(row => {
      if (row) activeFilterRows.push(row);
    });

    const activeFiltersHtml = activeFilterRows.length
      ? activeFilterRows.join("")
      : `<div class="song-count-dropdown-row">No filters used</div>`;

    const status = `${visibleCount} song${visibleCount !== 1 ? "s" : ""}`;
    const songCountEl = d3.select("#song-count");

    songCountEl.html(`
      <div class="sort-dropdown" data-sort-dropdown="song-count">
        <button type="button" id="song-count-btn" class="sort-dropdown-trigger" aria-haspopup="true" aria-expanded="false">
          ${status} ${getDropdownIconHtml()}
        </button>
        <div class="sort-dropdown-menu">
          <div class="sort-dropdown-title">Filters</div>
          ${activeFiltersHtml}
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
    clearChartNumberFilters();
    ratingMinFilter = 0.5;
    ratingMaxFilter = 5;
    lastClickedHistogramBin = null;
    mustContainAllSelectedGenres = false;
    mustContainAllSelectedDescriptors = false;
    showAllExcludingSelectedGenres = false;
    showAllExcludingSelectedDescriptors = false;
    d3.selectAll("#genres-must-contain-all, #descriptors-must-contain-all, #genres-exclude-selected, #descriptors-exclude-selected").property("checked", false);
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
    const chartGridScrollerNode = d3.select(".chart-grid-scroller").node();
    if (chartGridScrollerNode) return chartGridScrollerNode;

    const chartContainerNode = d3.select(".chart-container").node();
    if (chartContainerNode) return chartContainerNode;
    return d3.select(".chart-area").node() || document.scrollingElement || document.documentElement;
  }

  let currentChartDataColumns = ranks.length;

  function getCssPixelValue(node, propertyName, fallback) {
    const rawValue = window.getComputedStyle(node || document.documentElement).getPropertyValue(propertyName).trim();
    const parsed = Number.parseFloat(rawValue);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function syncChartTableMetrics(dataColumns = currentChartDataColumns) {
    const chartScroller = getChartScrollContainer();
    if (!chartScroller || !chartScroller.style) return;

    currentChartDataColumns = Math.max(0, Number(dataColumns) || 0);
    const yearColumnWidth = getCssPixelValue(chartScroller, "--year-column-width", 88);
    const minCellWidth = getCssPixelValue(chartScroller, "--chart-min-cell-width", 48);
    const containerStyles = window.getComputedStyle(chartScroller);
    const horizontalPadding =
      (Number.parseFloat(containerStyles.paddingLeft) || 0) +
      (Number.parseFloat(containerStyles.paddingRight) || 0);
    const availableTableWidth = Math.max(0, chartScroller.clientWidth - horizontalPadding);
    const minTableWidth = yearColumnWidth + (currentChartDataColumns * minCellWidth);
    const tableWidth = Math.max(availableTableWidth, minTableWidth);
    const activeCellWidth = currentChartDataColumns > 0
      ? Math.max(minCellWidth, (tableWidth - yearColumnWidth) / currentChartDataColumns)
      : minCellWidth;

    chartScroller.style.setProperty("--chart-data-columns", currentChartDataColumns);
    chartScroller.style.setProperty("--chart-table-width", `${tableWidth}px`);
    chartScroller.style.setProperty("--chart-cell-width", `${activeCellWidth}px`);
    chartScroller.classList.toggle("chart-min-cell-overflow", minTableWidth > availableTableWidth + 1);
  }

  function syncChartOverflowState() {
    const chartScroller = getChartScrollContainer();
    if (!chartScroller || !chartScroller.classList) return false;

    const hasOverflow = chartScroller.classList.contains("chart-min-cell-overflow");
    chartScroller.classList.toggle("chart-has-overflow", hasOverflow);
    return hasOverflow;
  }

  function syncChartScrollportWidth() {
    const chartScroller = getChartScrollContainer();
    if (!chartScroller || !chartScroller.style) return;
    syncChartTableMetrics();
    requestAnimationFrame(syncChartOverflowState);
  }

  function initChartDragPan() {
    const chartScroller = d3.select(".chart-grid-scroller").node();
    if (!chartScroller || initChartDragPan.bound) return;

    let panState = null;
    let panFrame = 0;
    let postPanTooltipTimer = 0;
    let postPanTooltipPoint = null;
    let suppressNextClick = false;
    const interactiveSelector = "button, a, input, select, textarea, [role='button'], #selected-song-bar, .chart-controls-row";

    const clearPostPanTooltip = () => {
      if (!postPanTooltipTimer) return;
      clearTimeout(postPanTooltipTimer);
      postPanTooltipTimer = 0;
      postPanTooltipPoint = null;
    };

    const schedulePostPanTooltip = (event) => {
      if (isMobileTooltipDisabled()) return;

      const pointerX = event.clientX;
      const pointerY = event.clientY;
      const delay = Math.max(0, chartTooltipSuppressUntil - performance.now()) + 20;

      clearPostPanTooltip();
      postPanTooltipPoint = { x: pointerX, y: pointerY };
      postPanTooltipTimer = setTimeout(() => {
        postPanTooltipTimer = 0;
        postPanTooltipPoint = null;
        const elements = typeof document.elementsFromPoint === "function"
          ? document.elementsFromPoint(pointerX, pointerY)
          : [document.elementFromPoint(pointerX, pointerY)].filter(Boolean);
        const cellNode = elements
          .map((el) => el?.closest?.(".chart-cell"))
          .find((el) => el && chartScroller.contains(el));
        if (!cellNode || !chartScroller.contains(cellNode)) return;
        if (cellNode.classList.contains("empty")) return;
        if (isPointerInsideStickyYearColumn({ clientX: pointerX, clientY: pointerY }, cellNode)) return;

        const song = d3.select(cellNode).datum();
        if (!song) return;

        activeTooltipCell = cellNode;
        activeTooltipMode = "chart";
        tooltip.classed("visible", false);
        scheduleChartTooltip(cellNode, song);
      }, delay);
    };

    const applyPanFrame = () => {
      panFrame = 0;
      if (!panState || !panState.moved) return;
      chartScroller.scrollLeft = panState.scrollLeft - panState.dx;
      chartScroller.scrollTop = panState.scrollTop - panState.dy;
    };

    chartScroller.addEventListener("scroll", () => {
      if (
        activeTooltipMode === "chart" &&
        (chartTooltipDelayTimer || activeTooltipCell || tooltip.classed("visible"))
      ) {
        hideChartTooltipForCell();
      }
    });

    chartScroller.addEventListener("pointerdown", (event) => {
      clearPostPanTooltip();
      if (event.pointerType === "touch") return;
      if (event.button !== 0 || event.target.closest(interactiveSelector)) return;
      if (!syncChartOverflowState()) return;
      if (!event.target.closest(".chart-table, .chart-rank-header")) return;

      panState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        scrollLeft: chartScroller.scrollLeft,
        scrollTop: chartScroller.scrollTop,
        dx: 0,
        dy: 0,
        active: false,
        moved: false
      };
    });

    chartScroller.addEventListener("pointermove", (event) => {
      if (!panState) {
        if (
          postPanTooltipPoint &&
          (Math.abs(event.clientX - postPanTooltipPoint.x) > 8 ||
            Math.abs(event.clientY - postPanTooltipPoint.y) > 8)
        ) {
          clearPostPanTooltip();
        }
        return;
      }
      if (!panState || event.pointerId !== panState.pointerId) return;
      const dx = event.clientX - panState.startX;
      const dy = event.clientY - panState.startY;
      const hasMoved = Math.abs(dx) > 6 || Math.abs(dy) > 6;
      if (!hasMoved && !panState.moved) return;
      if (!panState.active) {
        panState.active = true;
        hideChartTooltipForCell();
        chartScroller.setPointerCapture(event.pointerId);
        chartScroller.classList.add("is-panning");
      }
      panState.moved = true;
      panState.dx = dx;
      panState.dy = dy;
      if (!panFrame) panFrame = requestAnimationFrame(applyPanFrame);
      event.preventDefault();
    });

    const endPan = (event) => {
      if (!panState || event.pointerId !== panState.pointerId) return;
      if (panFrame) {
        cancelAnimationFrame(panFrame);
        applyPanFrame();
      }
      chartScroller.classList.remove("is-panning");
      if (chartScroller.hasPointerCapture(event.pointerId)) {
        chartScroller.releasePointerCapture(event.pointerId);
      }
      suppressNextClick = panState.moved;
      if (panState.moved) {
        chartTooltipSuppressUntil = performance.now() + 700;
        hideChartTooltipForCell();
        schedulePostPanTooltip(event);
      }
      panState = null;
    };

    chartScroller.addEventListener("pointerup", endPan);
    chartScroller.addEventListener("pointercancel", endPan);
    chartScroller.addEventListener("lostpointercapture", () => {
      clearPostPanTooltip();
      if (panFrame) {
        cancelAnimationFrame(panFrame);
        panFrame = 0;
      }
      chartScroller.classList.remove("is-panning");
      panState = null;
    });

    chartScroller.addEventListener("click", (event) => {
      if (!suppressNextClick) return;
      suppressNextClick = false;
      event.preventDefault();
      event.stopPropagation();
    }, true);

    initChartDragPan.bound = true;
  }

  function getChartTopObstructionHeight(scroller) {
    const stickySelectors = [".chart-rank-header"];
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
    const selectedColumnGap = 8;
    const rowNode = selectedCellNode.closest("tr") || selectedCellNode;

    const computeTargetTop = () => {
      const rect = rowNode.getBoundingClientRect();
      const scrollerRect = scroller?.getBoundingClientRect?.();
      const topInScroller = scrollerRect ? rect.top - scrollerRect.top : rect.top;
      const obstruction = getChartTopObstructionHeight(scroller);
      const currentScrollTop = scroller?.scrollTop || 0;
      return Math.max(0, Math.round(currentScrollTop + topInScroller - obstruction - selectedRowGap));
    };

    const computeTargetLeft = () => {
      if (!scroller || scroller === document.documentElement || scroller === document.body) return window.scrollX || window.pageXOffset || 0;

      const cellRect = selectedCellNode.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      const currentScrollLeft = scroller.scrollLeft || 0;
      const yearLabelNode = rowNode.querySelector?.(".year-label") || document.querySelector(".chart-table .year-label");
      const yearColumnWidth = yearLabelNode?.getBoundingClientRect?.().width || 0;
      const visibleLeft = scrollerRect.left + yearColumnWidth + selectedColumnGap;
      const visibleRight = scrollerRect.right - selectedColumnGap;

      if (cellRect.left >= visibleLeft && cellRect.right <= visibleRight) return currentScrollLeft;

      if (cellRect.left < visibleLeft) {
        return Math.max(0, Math.round(currentScrollLeft + (cellRect.left - visibleLeft)));
      }

      return Math.max(0, Math.round(currentScrollLeft + (cellRect.right - visibleRight)));
    };

    if (typeof scroller?.scrollTo === "function") {
      scroller.scrollTo({ top: computeTargetTop(), left: computeTargetLeft(), behavior: "smooth" });
    } else {
      window.scrollTo({ top: computeTargetTop(), behavior: "smooth" });
    }
  }

  // hook global toggle button
  d3.select("#toggle-all-global").on("click", toggleAllGlobal);
  setCurrentVideoPlaying(false);

  function buildSongDescriptorsGroupedHtml(descriptorKeys) {
    const categoryOrder = ["Atmosphere", "Form", "Lyrics", "Mood", "Style", "Technique", "Theme", "Vocals"];
    const groups = {};
    categoryOrder.forEach((category) => { groups[category] = []; });
    const otherDescriptors = [];

    const getDescriptorLabel = (key) => {
      const meta = descriptors[key];
      return meta?.label || key;
    };

    const resolveDescriptorCategory = (key) => {
      const meta = descriptors[key];
      const rawGroups = Array.isArray(meta?.descriptorGroup)
        ? meta.descriptorGroup
        : (meta?.descriptorGroup ? [meta.descriptorGroup] : []);
      const normalizedGroups = rawGroups.map(g => String(g || "").trim().toLowerCase());
      return categoryOrder.find(category => normalizedGroups.includes(category.toLowerCase())) || null;
    };

    Array.from(new Set((descriptorKeys || []).filter(Boolean))).forEach((key) => {
      const category = resolveDescriptorCategory(key);
      const descriptorHtml = `<span class="clickable-descriptor" data-descriptor="${key}">${getDescriptorLabel(key)}</span>`;
      if (category) groups[category].push(descriptorHtml);
      else otherDescriptors.push(descriptorHtml);
    });

    const groupHtml = categoryOrder
      .filter(category => groups[category].length > 0)
      .map(category => `
        <div class="song-descriptor-group">
          <h3 class="song-descriptor-group-title">${category}</h3>
          <p class="song-descriptor-group-items">${groups[category].join(" • ")}</p>
        </div>
      `);

    if (otherDescriptors.length > 0) {
      groupHtml.push(`
        <div class="song-descriptor-group">
          <h3 class="song-descriptor-group-title">Other</h3>
          <p class="song-descriptor-group-items">${otherDescriptors.join(" • ")}</p>
        </div>
      `);
    }

    return groupHtml.length
      ? `<div class="song-descriptors-row song-descriptors-row--grouped">${groupHtml.join("")}</div>`
      : "";
  }


  // Table
  const table = d3.select(".chart-grid-scroller").append("table").attr("class", "chart-table");
  const tbody = table.append("tbody");

  function applyChartTableColgroup(totalColumns) {
    const safeColumns = Math.max(1, Number(totalColumns) || 1);
    const dataColumns = Math.max(0, safeColumns - 1);

    syncChartTableMetrics(dataColumns);
    table.style("--chart-data-columns", dataColumns);
    table.select("colgroup").remove();
    const colgroup = table.insert("colgroup", ":first-child");
    colgroup.append("col").attr("class", "chart-year-col");
    for (let i = 0; i < dataColumns; i += 1) {
      colgroup.append("col").attr("class", "chart-data-col");
    }
  }

  queueHeaderStickyOffsetSync();
  window.addEventListener("resize", queueHeaderStickyOffsetSync);
  syncChartScrollportWidth();
  window.addEventListener("resize", syncChartScrollportWidth);
  initChartDragPan();
  ensureYearLabelResizeListener();
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => queueHeaderStickyOffsetSync());
  }

  buildTable();
  renderChartSortControl();
  renderChartRankHeader();

  function ensureChartSortControlHostLocation() {
    const host = document.getElementById("chart-sort-control-host");
    if (!host) return;

    const desktopSlot = document.querySelector(".chart-controls-right");

    if (desktopSlot && host.parentElement !== desktopSlot) desktopSlot.appendChild(host);
  }

  ensureChartSortControlHostLocation(); 
  window.addEventListener("resize", ensureChartSortControlHostLocation); 
 
  initContextSideNav(); 
  updateContextColumn(); 
 
  // populate static context cells (all available, collapsed by default) 
  [renderGenreListCell, renderDescriptorsListCell, renderCategoriesPanel, renderCountriesPanel, renderArtistsPanel, renderRatingsPanel, renderAboutPanel].forEach((renderFn) => { 
    try { 
      renderFn(); 
    } catch (error) { 
      console.error("Panel render failed:", error); 
    } 
  }); 

  // Default selected tile on initial load: first song in the chart list.
  if (selectedSongIndex === -1 && currentSongList.length > 0) {
    showSongModal(0, getPreferredVisibleSongSide(currentSongList[0]), false, false, true);
  }

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
    syncChartScrollportWidth();
    const chartScroller = getChartScrollContainer();
    const priorChartScrollTop = chartScroller?.scrollTop || 0;
    const priorChartScrollLeft = chartScroller?.scrollLeft || 0;

    tbody.html("");
    currentSongList = [];
    const isYearFiltered = hasAnySelectedValue(selectedYear);
    const isRankFiltered = sortMode === "chart" && hasAnySelectedValue(selectedRank);
    table.classed("year-filter-active", isYearFiltered);

    function appendYearLabelCell(row, year) {
      const isSelected = hasSelectedValue(selectedYear, year);
      row.append("td")
        .attr("class", "year-label year-label-toggle")
        .attr("data-year", year)
        .classed("year-label-active", isSelected)
        .attr("role", "button")
        .attr("tabindex", 0)
        .attr("aria-pressed", isSelected ? "true" : "false")
        .attr("title", isSelected
          ? (lastClickedYearFilter === year ? "Reset year filter" : `${year} selected`)
          : `Add ${year}`)
        .text(formatYearLabelText(year))
        .on("click", () => {
          const nextSelection = addOrRepeatToggleSelectedValue(selectedYear, year, lastClickedYearFilter);
          selectedYear = nextSelection.values;
          lastClickedYearFilter = nextSelection.lastClicked;
          buildTable();
        })
        .on("keydown", function(event) {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          const nextSelection = addOrRepeatToggleSelectedValue(selectedYear, year, lastClickedYearFilter);
          selectedYear = nextSelection.values;
          lastClickedYearFilter = nextSelection.lastClicked;
          buildTable();
        });
    }

    if (sortMode === "chart") {
      applyChartTableColgroup(ranks.length + 1);
      // each row corresponds to a year; columns are ranks 1–10
      years.forEach(year => {
        const tr = tbody.append("tr");
        appendYearLabelCell(tr, year);
        const showYearSongs = !isYearFiltered || hasSelectedValue(selectedYear, year);
        ranks.forEach(rank => {
          const showRankSongs = !isRankFiltered || hasSelectedValue(selectedRank, rank);
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
          const ai = taxonomyOrder.indexOf(getSongTaxonomyForVisibleSides(a));
          const bi = taxonomyOrder.indexOf(getSongTaxonomyForVisibleSides(b));
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
        const showYearSongs = !isYearFiltered || hasSelectedValue(selectedYear, year);
        for (let colIndex = 0; colIndex < maxCols; colIndex++) {
          const song = songsByYear[year][colIndex];
          appendCell(tr, song, !showYearSongs);
          if (showYearSongs && song) currentSongList.push(song);
        }
      });
    }
    syncSelectedSongCellSelection();
    requestAnimationFrame(syncChartOverflowState);
    // update helpers after rebuilding
    recomputeVisibleSongCountsCache();
    updateStatusBar();
    refreshRenderedContextPanels({ preserveScroll: true });
    updateContextColumn();
    syncYearLabelText();

    // Rebuilding the table can reset/clamp scroll; restore it so filter updates don't jump to top.
    if (chartScroller) {
      const restoreChartScroll = () => {
        const maxTop = Math.max(0, chartScroller.scrollHeight - chartScroller.clientHeight);
        const maxLeft = Math.max(0, chartScroller.scrollWidth - chartScroller.clientWidth);
        chartScroller.scrollTop = Math.min(Math.max(0, priorChartScrollTop), maxTop);
        chartScroller.scrollLeft = Math.min(Math.max(0, priorChartScrollLeft), maxLeft);
      };

      restoreChartScroll();
      requestAnimationFrame(restoreChartScroll);
    }
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
  const excludeSelectedGenres = showAllExcludingSelectedGenres && anyGenreChecked;
  const excludeSelectedDescriptors = showAllExcludingSelectedDescriptors && anyDescriptorChecked;

  const songGenreSet = mustContainAllSelectedGenres ? new Set(songGenres) : null;
  const songDescriptorSet = mustContainAllSelectedDescriptors ? new Set(songDescriptors) : null;
  const selectedGenreSet = excludeSelectedGenres ? new Set(selectedGenres) : null;
  const selectedDescriptorSet = excludeSelectedDescriptors ? new Set(selectedDescriptors) : null;

  let genreOk = false;
  if (excludeSelectedGenres) {
    genreOk = !songGenres.some(g => selectedGenreSet.has(g));
  } else if (!anyTaxChecked) {
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
    if (!anyGenreChecked) genreOk = true;
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
  if (excludeSelectedDescriptors) {
    descriptorOk = !songDescriptors.some(d => selectedDescriptorSet.has(d));
  } else if (!anyDescriptorChecked) descriptorOk = true;
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

  function isPointerInsideStickyYearColumn(event, cellNode) {
    if (!event || !cellNode) return false;

    const rowNode = cellNode.closest("tr");
    const yearLabelNode = rowNode?.querySelector(".year-label");
    if (!yearLabelNode) return false;

    const rect = yearLabelNode.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;

    return (
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    );
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

      // Print/title helpers: store which side(s) are currently "visible" under the genre filter.
      // This lets print/export or any CSS that surfaces titles show A, B, or A/B correctly.
      const visibleSides = getVisibleSidesForSong(song);
      const visibleTaxonomyKey = getSongTaxonomyForVisibleSides(song, visibleSides);
      cell.style("background-color", taxonomy[visibleTaxonomyKey]?.color || "#2c292b");
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
    cell.on("mouseenter", function (event) {
      if (!song || isMobileTooltipDisabled()) return;
      if (isPointerInsideStickyYearColumn(event, this)) return;
      if (performance.now() < chartTooltipSuppressUntil) return;
      activeTooltipCell = this;
      activeTooltipMode = "chart";
      tooltip.classed("visible", false);
      scheduleChartTooltip(this, song);
    })
    .on("mousemove", function(event) {
      if (!song || isMobileTooltipDisabled()) return;
      if (performance.now() < chartTooltipSuppressUntil) return;
      if (isPointerInsideStickyYearColumn(event, this)) {
        hideChartTooltipForCell(this);
        return;
      }
      activeTooltipCell = this;
      activeTooltipMode = "chart";
      if (!chartTooltipDelayTimer && tooltip.classed("visible")) queueTooltipReposition();
    })
    .on("mouseleave", function() {
      if (isMobileTooltipDisabled()) return;
      hideChartTooltipForCell(this);
    })
    .on("click", function(event) {
      if (!song) return;
      if (isPointerInsideStickyYearColumn(event, this)) return;
      let songIndex = currentSongList.indexOf(song);
      if (songIndex === -1) songIndex = currentSongList.findIndex(s => s.chartYear === song.chartYear && s.rank === song.rank);
      if (songIndex === -1) return;
      const visibleSides = getVisibleSidesForSong(song);
      const clickSide = visibleSides.includes("A") ? "A" : visibleSides[0] || "A";

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
    // Never hijack the user's current panel/scroll just because filters changed.
    // If a "selected" block is open, rebuild it; otherwise just refresh visible panels in-place.
    if (!currentPanel.type) {
      refreshRenderedContextPanels({ preserveScroll: true });
      return;
    }

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

  d3.select("#toggle-all-global").text(allGlobalChecked ? "Hide all" : "Show all");
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
  return `${getSortModeText(mode)} ${getDropdownIconHtml()}`;
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

function isCountSortMode(mode) {
  return mode === "popular" || mode === "unpopular";
}

function renderSortByVisibleToggleHtml(dropdownKey, currentMode, checked) {
  if (!isCountSortMode(currentMode)) return "";
  return `
    <div class="panel-controls-row panel-controls-row--checkbox">
      <label class="must-contain-all-toggle">
        <input type="checkbox" id="${dropdownKey}-sort-visible" ${checked ? "checked" : ""}>
        <span>Sort by visible</span>
      </label>
    </div>
  `;
}

function bindSortByVisibleToggle(dropdownKey, setChecked, rerender) {
  d3.select(`#${dropdownKey}-sort-visible`).on("change", function() {
    setChecked(!!this.checked);
    if (typeof rerender === "function") rerender();
  });
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
        ${getGenreListViewText(currentView)} ${getDropdownIconHtml()}
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
        ${getDescriptorListViewText(currentView)} ${getDropdownIconHtml()}
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
    "TRINIDAD AND TOBAGO": "TT",
    CROATIA: "HR",
    NORWAY: "NO"
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
    ${renderPanelSelectedBlockHtml("categories")}
    <p class="panel-description">The base genres used to categorise the songs.</p>
    <div class="panel-controls-row">
      <button id="toggle-all-categories">${toggleAllLabel}</button>
    </div>
    <br>
    <ul>
      ${orderedKeys.map(tKey => {
        const info = taxonomy[tKey] || {};
        const label = info.label || tKey;
        const totalCount = songs.filter(s => getAllSongTaxonomies(s).includes(tKey)).length;
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

  bindPanelSelectedBlockInteractions("categories", {
    rerender: renderCategoriesPanel,
    containerSelector: "#categories-cell"
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
  const countA = sortCountriesByVisible ? (visibleSongCountsCache.countries[a[0]] || 0) : a[1];
  const countB = sortCountriesByVisible ? (visibleSongCountsCache.countries[b[0]] || 0) : b[1];
  const diff = countB - countA;
  if (diff !== 0) return diff;
  return a[0].localeCompare(b[0]);
  });
  else if (countrySortMode === "unpopular") sorted.sort((a,b) => {
  const countA = sortCountriesByVisible ? (visibleSongCountsCache.countries[a[0]] || 0) : a[1];
  const countB = sortCountriesByVisible ? (visibleSongCountsCache.countries[b[0]] || 0) : b[1];
  const diff = countA - countB;
  if (diff !== 0) return diff;
  return a[0].localeCompare(b[0]);
});

  const countriesBodyHtml = `
    ${renderPanelSelectedBlockHtml("countries")}
    <p class="panel-description">Filter the chart by artist country.</p>
    <div class="panel-controls-row">
      <button id="toggle-all-countries">${getToggleAllLabelFor(countryVisibility)}</button>
      ${renderSortDropdownHtml("countries", countrySortMode)}
    </div>
    ${renderSortByVisibleToggleHtml("countries", countrySortMode, sortCountriesByVisible)}
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

  bindPanelSelectedBlockInteractions("countries", {
    rerender: renderCountriesPanel,
    containerSelector: "#countries-cell"
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
  bindSortByVisibleToggle(
    "countries",
    (checked) => { sortCountriesByVisible = checked; },
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
  const countA = sortArtistsByVisible ? (visibleSongCountsCache.artists[a[0]] || 0) : a[1];
  const countB = sortArtistsByVisible ? (visibleSongCountsCache.artists[b[0]] || 0) : b[1];
  const diff = countB - countA;
  if (diff !== 0) return diff;
  return a[0].localeCompare(b[0]);
});

  else if (artistSortMode === "unpopular") sorted.sort((a,b) => {
  const countA = sortArtistsByVisible ? (visibleSongCountsCache.artists[a[0]] || 0) : a[1];
  const countB = sortArtistsByVisible ? (visibleSongCountsCache.artists[b[0]] || 0) : b[1];
  const diff = countA - countB;
  if (diff !== 0) return diff;
  return a[0].localeCompare(b[0]);
});

  const artistsBodyHtml = `
    ${renderPanelSelectedBlockHtml("artists")}
    <p class="panel-description">Filter the chart by artists.</p>
    <div class="panel-controls-row">
      <button id="toggle-all-artists">${getToggleAllLabelFor(artistVisibility)}</button>
      ${renderSortDropdownHtml("artists", artistSortMode)}
    </div>
    ${renderSortByVisibleToggleHtml("artists", artistSortMode, sortArtistsByVisible)}
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

  bindPanelSelectedBlockInteractions("artists", {
    rerender: renderArtistsPanel,
    containerSelector: "#artists-cell"
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
  bindSortByVisibleToggle(
    "artists",
    (checked) => { sortArtistsByVisible = checked; },
    renderArtistsPanel
  );

  bindGenreClicks();
}

// Ratings panel
function renderRatingsPanel() {
  const minRating = 0.5;
  const maxRating = 5;
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

  const labels = [];
  for (let v = minRating; v <= maxRating + 1e-9; v += 0.5) {
    labels.push(Number(v.toFixed(2)));
  }

  const labelsHtml = labels.map((v) => {
    const pct = ((v - minRating) / (maxRating - minRating)) * 100;
    return `<span class="rating-range-label" style="left:${pct}%">${formatLabel(v)}</span>`;
  }).join("");

  const ratingBins = allTicks.slice(0, -1).map((lower, index) => ({
    lower,
    upper: allTicks[index + 1],
    count: 0
  }));

  songs.forEach((song) => {
    const sides = song?.tracks?.[1]?.youtubeId ? ["A", "B"] : ["A"];
    sides.forEach((side) => {
      const score = getSongRatingScoreForSide(song, side);
      if (score === null || !Number.isFinite(Number(score))) return;
      const binIndex = Math.min(
        ratingBins.length - 1,
        Math.max(0, Math.floor((Number(score) - minRating) / tickStep))
      );
      const bin = ratingBins[binIndex];
      if (!bin || Number(score) < bin.lower || Number(score) > bin.upper) return;
      bin.count += 1;
    });
  });

  const maxBinCount = Math.max(1, ...ratingBins.map(bin => bin.count));
  const histogramHtml = ratingBins.map((bin) => {
    const heightPct = bin.count > 0 ? Math.max(5, (bin.count / maxBinCount) * 100) : 0;
    const songLabel = bin.count === 1 ? "song" : "songs";
    const label = `${formatLabel(bin.lower)}-${formatLabel(bin.upper)}: ${bin.count} ${songLabel}`;
    return `<span class="rating-histogram-column" role="button" tabindex="0" data-rating-lower="${bin.lower}" data-rating-upper="${bin.upper}" data-rating-count="${bin.count}" aria-label="${label}"><span class="rating-histogram-bar" style="height:${heightPct}%;"></span></span>`;
  }).join("");

  const ratingsBodyHtml = `
    <p class="panel-description">Filter the chart by RYM rating (weighted average of available single and track ratings on Rate Your Music).</p>
    <div class="rating-range">
      <div class="rating-range-header">
        <span class="rating-range-value" id="rating-range-value"></span>
        <button type="button" id="rating-reset">Reset</button>
      </div>
      <div class="rating-histogram" style="--rating-histogram-bars:${ratingBins.length};" aria-label="Rating distribution">${histogramHtml}</div>
      <div class="rating-range-slider" id="rating-range-slider">
        <div class="rating-range-track"></div>
        <div class="rating-range-highlight" id="rating-range-highlight"></div>
        <input type="range" id="rating-range-min" min="${minRating}" max="${maxRating}" step="any" value="${ratingMinFilter}">
        <input type="range" id="rating-range-max" min="${minRating}" max="${maxRating}" step="any" value="${ratingMaxFilter}">
        <div class="rating-range-labels">${labelsHtml}</div>
      </div>
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
  const histogramBars = d3.selectAll(".rating-histogram-column");

  const syncUi = () => {
    const minVal = clampToRange(minInput.property("value"));
    const maxVal = clampToRange(maxInput.property("value"));
    const leftPct = ((minVal - minRating) / (maxRating - minRating)) * 100;
    const rightPct = 100 - ((maxVal - minRating) / (maxRating - minRating)) * 100;

    valueEl.html(`
      <span>${formatLabel(minVal)}</span>
      <span class="rating-range-arrow" aria-hidden="true"></span>
      <span>${formatLabel(maxVal)}</span>
      <span>stars</span>
    `);
    highlightEl.style("left", `${leftPct}%`).style("right", `${rightPct}%`);
    histogramBars.classed("is-outside-range", function() {
      const lower = Number(d3.select(this).attr("data-rating-lower"));
      const upper = Number(d3.select(this).attr("data-rating-upper"));
      return Number.isFinite(lower) && Number.isFinite(upper) && (upper <= minVal || lower >= maxVal);
    }).classed("is-selected-range", function() {
      const lower = Number(d3.select(this).attr("data-rating-lower"));
      const upper = Number(d3.select(this).attr("data-rating-upper"));
      return Number.isFinite(lower) && Number.isFinite(upper) && lower >= minVal && upper <= maxVal;
    });

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
    lastClickedHistogramBin = null;
    minInput.property("value", ratingMinFilter);
    maxInput.property("value", ratingMaxFilter);
    syncUi();
    applyRatingFilter();
  };

  minInput.on("change", applyOnRelease);
  maxInput.on("change", applyOnRelease);

  const applyHistogramRange = (barNode) => {
    const bar = d3.select(barNode);
    const lower = clampToRange(bar.attr("data-rating-lower"));
    const upper = clampToRange(bar.attr("data-rating-upper"));
    if (!Number.isFinite(lower) || !Number.isFinite(upper)) return;

    const clickedBin = `${lower}-${upper}`;
    const selectedSameBin = Math.abs(ratingMinFilter - lower) < 1e-9 && Math.abs(ratingMaxFilter - upper) < 1e-9;
    const clickedInsideRange = lower >= ratingMinFilter - 1e-9 && upper <= ratingMaxFilter + 1e-9;
    const fullRangeSelected = Math.abs(ratingMinFilter - minRating) < 1e-9 && Math.abs(ratingMaxFilter - maxRating) < 1e-9;

    if (selectedSameBin) {
      ratingMinFilter = minRating;
      ratingMaxFilter = maxRating;
      lastClickedHistogramBin = null;
    } else if (fullRangeSelected || clickedInsideRange) {
      ratingMinFilter = lower;
      ratingMaxFilter = upper;
      lastClickedHistogramBin = clickedBin;
    } else {
      ratingMinFilter = Math.min(ratingMinFilter, lower);
      ratingMaxFilter = Math.max(ratingMaxFilter, upper);
      lastClickedHistogramBin = clickedBin;
    }

    minInput.property("value", ratingMinFilter);
    maxInput.property("value", ratingMaxFilter);
    syncUi();
    activeTooltipCell = null;
    activeTooltipMode = "chart";
    tooltip.classed("visible", false);
    applyRatingFilter();
  };

  histogramBars
    .on("mouseenter", function() {
      if (isMobileTooltipDisabled()) return;
      const bar = d3.select(this);
      const lower = Number(bar.attr("data-rating-lower"));
      const upper = Number(bar.attr("data-rating-upper"));
      const count = Number(bar.attr("data-rating-count")) || 0;
      const songLabel = count === 1 ? "song" : "songs";

      activeTooltipCell = this;
      activeTooltipMode = "histogram";
      tooltip
        .style("max-width", "min(260px, calc(100vw - 20px))")
        .classed("visible", true)
        .html(`
          <h2>${formatLabel(lower)}-${formatLabel(upper)} stars</h2>
          <p>${count} ${songLabel}</p>
        `);
      fitTooltipTextToWidth();
      positionTooltipForElement(this);
    })
    .on("mousemove", function() {
      if (activeTooltipCell === this) positionTooltipForElement(this);
    })
    .on("mouseleave", function() {
      if (activeTooltipCell === this) activeTooltipCell = null;
      activeTooltipMode = "chart";
      tooltip.classed("visible", false);
    })
    .on("click", function(event) {
      event.preventDefault();
      applyHistogramRange(this);
    })
    .on("keydown", function(event) {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      applyHistogramRange(this);
    });

  d3.select("#rating-reset").on("click", () => {
    ratingMinFilter = minRating;
    ratingMaxFilter = maxRating;
    lastClickedHistogramBin = null;
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
  function showSongModal(songIndex, side = "A", autoPlay = false, alignTileTop = false, resetContextScroll = false, variant = "chart") {
    const song = currentSongList[songIndex];
    if (!song) return;

    currentVideoTime = 0;
    currentVideoDuration = 0;
    isVideoScrubbing = false;

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
    const originalVersion = getOriginalVersionForSong(song, selectedSongSide);
    const isOriginalVersion = variant === "original" && !!originalVersion;
    selectedSongVariant = isOriginalVersion ? "original" : "chart";
    const displaySong = (isOriginalVersion && originalVersion.sourceSong) ? originalVersion.sourceSong : song;
    const displaySide = (isOriginalVersion && originalVersion.sourceSong) ? originalVersion.sourceSide : selectedSongSide;
    const currentTrack = isOriginalVersion
      ? { title: originalVersion.title || "Original version", youtubeId: originalVersion.youtubeId }
      : (selectedSongSide === "B" ? song.tracks[1] : song.tracks[0]);
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
    const hasOriginalChartMatch = isOriginalVersion && !!originalVersion.sourceSong;
    const sideGenres = hasOriginalChartMatch
      ? getSongGenresForSide(displaySong, displaySide)
      : (isOriginalVersion ? { primarygenre: null, subgenres: [] } : getSongGenresForSide(song, selectedSongSide));
    const genreSpans = [sideGenres.primarygenre, ...(sideGenres.subgenres || [])]
      .filter(Boolean)
      .map(g => `<span class="clickable-genre" data-genre="${g}">${g}</span>`)
      .join(" • ");
    const descriptorsGroupedHtml = buildSongDescriptorsGroupedHtml(
      hasOriginalChartMatch
        ? getSongDescriptorsForSide(displaySong, displaySide)
        : (isOriginalVersion ? [] : getSongDescriptorsForSide(song, selectedSongSide))
    );
    const buildSongSectionDividerHtml = (label) => `
      <div class="song-section-divider" aria-hidden="true">
        <span>${label}</span>
      </div>
    `;
    const descriptorsRowHtml = descriptorsGroupedHtml
      ? `${buildSongSectionDividerHtml("Descriptors")}${descriptorsGroupedHtml}`
      : "";

    // Build ratings row
    const ratings = hasOriginalChartMatch
      ? getSongRatingsForSide(displaySong, displaySide)
      : (isOriginalVersion ? { primary: null, single: null, track: null } : getSongRatingsForSide(song, selectedSongSide));
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

      ratingsRowHtml = `${buildSongSectionDividerHtml("Ratings")}<p class="song-ratings-row"><span class="primary-rating">${primaryText}</span><br><span class="secondary-ratings">${singleText}, ${trackText}</span></p>`;
    }

    const displayArtists = isOriginalVersion
      ? (hasOriginalChartMatch
          ? getArtistsForSide(displaySong, displaySide)
          : [{
              artist: originalVersion.artist || "",
              country: originalVersion.country || ""
            }].filter(d => d.artist || d.country))
      : getArtistsForSide(song, selectedSongSide);
    const artistCountryPairsHtml = displayArtists
      .map(({ artist, country }) => {
        const flagClass = country ? getFlagIconClass(country) : "";
        const flagHtml = flagClass
          ? `<span class="country-flag ${flagClass} clickable-country" data-country="${country}" title="${country}" aria-label="${country}" role="img"></span>`
          : "";

        return `<span class="artist-country-pair"><span class="artist-name clickable-artist" data-artist="${artist}">${artist}</span>${flagHtml}</span>`;
      })
      .join(getSongArtistSeparator(hasOriginalChartMatch ? displaySong : song));
    // Peak chart info
    let peakInfo = "";
    const chartInfoSong = hasOriginalChartMatch ? displaySong : song;
    if (chartInfoSong.peakPos) {
      peakInfo = `Peaked at #${chartInfoSong.peakPos}`;
      if (chartInfoSong.weeksOnChart) {
        peakInfo += ` for ${chartInfoSong.weeksOnChart} week${chartInfoSong.weeksOnChart > 1 ? "s" : ""}`;
      }
    }
    const chartInfoParts = [`Rank #${chartInfoSong.rank} for ${chartInfoSong.chartYear}`];
    if (peakInfo) chartInfoParts.push(peakInfo);
    chartInfoParts.push(`Released ${chartInfoSong.releaseYear}`);
    const chartInfoText = isOriginalVersion && !hasOriginalChartMatch ? "Original version" : chartInfoParts.join("  •  ");

    const currentSideOrVersionLabel = hasSecondTitle
      ? (selectedSongSide === "A" ? "A Side" : "B Side")
      : (selectedSongSide === "A" ? "Ver 1" : "Ver 2");
    const nextSideOrVersionLabel = hasSecondTitle
      ? (selectedSongSide === "A" ? "B Side" : "A Side")
      : (selectedSongSide === "A" ? "Ver 2" : "Ver 1");
    const songBodySideToggleHtml = (!isOriginalVersion && hasSecondTrack && visibleSides.length === 2)
      ? `
        <div class="song-side-toggle-row">
          <button type="button" class="song-side-toggle-btn" title="Change song side" aria-label="Change song side">
            Change to ${nextSideOrVersionLabel}
          </button>
        </div>
      `
      : "";
    const originalVersionToggleHtml = originalVersion
      ? `
        <div class="song-original-toggle-row">
          <button type="button" class="song-original-toggle-btn">
            ${isOriginalVersion ? "Show charting version" : "Show original version"}
          </button>
        </div>
      `
      : "";

    const selectedTaxonomyKey = hasOriginalChartMatch ? getSongTaxonomyForSide(displaySong, displaySide) : (isOriginalVersion ? "" : getSongTaxonomyForSide(song, selectedSongSide));
    const tax = taxonomy[selectedTaxonomyKey];
    const showSongMetadataSections = !isOriginalVersion || hasOriginalChartMatch;
    // Fill modal cell content
    const songBodyHtml = `
      <div id="video-container">${videoHtml(currentTrack)}</div>
      <div class="song-body-content">
        <h1 class="song-selected-title"><span class="song-selected-title-text">${selectedSideTitle}</span></h1>
        <div class="song-gap-half" aria-hidden="true"></div>
        <p class="song-artists-line"><span class="artists artists-with-flags">${artistCountryPairsHtml}</span></p>
        ${songBodySideToggleHtml}
        <div class="song-gap-full" aria-hidden="true"></div>
        <p class="song-chart-info-line">${chartInfoText}</p>
        ${showSongMetadataSections ? '<div class="song-gap-full" aria-hidden="true"></div>' : ''}
        ${showSongMetadataSections ? buildSongSectionDividerHtml("Genres") : ""}
        ${showSongMetadataSections ? `<div class="song-taxonomy-row">${tax ? `<div class="genre-badge clickable-taxonomy" style="${getTaxonomyBadgeStyle(tax.color)}" data-taxonomy="${selectedTaxonomyKey}">${tax.label}</div>` : ""}</div>` : ""}
        ${showSongMetadataSections ? '<div class="song-gap-full" aria-hidden="true"></div>' : ''}
        ${showSongMetadataSections ? `<p class="song-genres-row">${genreSpans}</p>` : ""}
        ${descriptorsRowHtml ? '<div class="song-gap-full" aria-hidden="true"></div>' : ''}
        ${descriptorsRowHtml}
        ${ratingsRowHtml ? '<div class="song-gap-full" aria-hidden="true"></div>' : ''}
        ${ratingsRowHtml}
        ${originalVersionToggleHtml ? '<div class="song-gap-full" aria-hidden="true"></div>' : ''}
        ${originalVersionToggleHtml}
      </div>
    `;

    const buildCompactSongBarHtml = () => `
      <div class="song-compact-meta">
        <span class="song-compact-title">${selectedSideTitle}</span>
        <span class="song-compact-artist">${displayArtists.map(d => d.artist).filter(Boolean).join(isOriginalVersion ? getSongArtistSeparator(displaySong) : getSongArtistSeparator(song))}</span>
      </div>
      <div class="song-compact-controls">
        ${(!isOriginalVersion && hasSecondTrack && visibleSides.length === 2) ? `<button type="button" class="song-compact-toggle-side-btn" title="Toggle side" aria-label="Toggle side">${currentSideOrVersionLabel}</button>` : ""}
        <div class="song-compact-transport">
          <button type="button" class="song-compact-transport-btn song-compact-prev-btn" data-action="prev" aria-label="Previous song"><span class="play-icon">${getStepButtonIconSvg("prev")}</span></button>
          <button type="button" class="song-compact-transport-btn song-compact-play-btn" data-action="play" aria-label="Play video"><span class="play-icon">${getPlayButtonIconSvg(false)}</span></button>
          <button type="button" class="song-compact-transport-btn song-compact-next-btn" data-action="next" aria-label="Next song"><span class="play-icon">${getStepButtonIconSvg("next")}</span></button>
        </div>
      </div>
      <div class="song-compact-scrubber">
        <span class="song-compact-scrub-time song-compact-scrub-current">0:00</span>
        <input type="range" class="song-compact-scrub-input" min="0" max="0" step="0.1" value="0" aria-label="Video position" disabled>
        <span class="song-compact-scrub-time song-compact-scrub-duration">0:00</span>
      </div>
    `;

    const songBarHtml = buildCompactSongBarHtml();

    const selectedSongBar = d3.select("#selected-song-bar")
      .style("display", "grid")
      .attr("role", "button")
      .attr("tabindex", "0")
      .attr("aria-label", "Open selected song")
      .html(songBarHtml);
    syncSelectedSongScrubberUi({ force: true });

    if (tax?.color) {
      selectedSongBar
        .style("border-color", tax.color)
        .style("background-color", hexToRgba(tax.color, 0.1));
    } else { 
      selectedSongBar
        .style("border-color", "")
        .style("background-color", ""); 
    } 
 
    d3.select("#song-modal-cell").style("display", "block"); 
    if (!isMobileOverlayMode()) { 
      setActiveContextPanel("song", { scrollToTop: false }); 
    } 
    renderAccordionCell("#song-modal-cell", { 
      key: "song", 
      title: "", 
      bodyHtml: songBodyHtml, 
      defaultOpen: true,
      headerBorderColor: tax?.color || "",
      showHeader: false
    });
    ensureYouTubeMessageListener();
    registerCurrentYouTubePlayer();

    const currentIframe = getCurrentVideoIframe();
    if (currentIframe) {
      currentIframe.addEventListener("load", registerCurrentYouTubePlayer, { once: true });
    }

    setCurrentVideoPlaying(!!autoPlay);

    bindGenreClicks();

    d3.selectAll(".clickable-genre").on("click", function() { 
      const gKey = d3.select(this).attr("data-genre"); 
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

    function toggleOriginalVersion() {
      showSongModal(
        songIndex,
        selectedSongSide,
        false,
        false,
        false,
        isOriginalVersion ? "chart" : "original"
      );
    }

    const bindCompactSongBarControls = (containerSelector, { stopPropagation = false } = {}) => {
      const root = d3.select(containerSelector);
      if (root.empty()) return;

      const withMaybeStop = (handler) => {
        return function(event) {
          if (stopPropagation && event) event.stopPropagation();
          handler(event);
        };
      };

      root.selectAll('[data-action="prev"]').on("click", withMaybeStop(() => movePrevSong()));
      root.selectAll('[data-action="next"]').on("click", withMaybeStop(() => moveNextSong()));
      root.selectAll('[data-action="play"]').on("click", withMaybeStop(() => toggleCurrentVideoPlayback()));
      root.selectAll(".song-compact-toggle-side-btn").on("click", withMaybeStop(() => toggleSongSide()));
      root.selectAll(".song-side-toggle-btn").on("click", withMaybeStop(() => toggleSongSide()));
      root.selectAll(".song-original-toggle-btn").on("click", withMaybeStop(() => toggleOriginalVersion()));
      root.selectAll(".song-compact-scrub-input")
        .on("input", function(event) {
          if (stopPropagation && event) event.stopPropagation();
          isVideoScrubbing = true;
          currentVideoTime = Number(this.value) || 0;
          syncSelectedSongScrubberUi();
        })
        .on("change", function(event) {
          if (stopPropagation && event) event.stopPropagation();
          const target = Number(this.value) || 0;
          isVideoScrubbing = false;
          seekCurrentVideoTo(target);
        })
        .on("pointerdown", function(event) {
          if (stopPropagation && event) event.stopPropagation();
          isVideoScrubbing = true;
        })
        .on("pointerup", function() { isVideoScrubbing = false; })
        .on("pointercancel", function() { isVideoScrubbing = false; })
        .on("blur", function() { isVideoScrubbing = false; });
    };

    // Keep compact transport/scrubber controls from triggering the selected bar opener.
    bindCompactSongBarControls("#selected-song-bar", { stopPropagation: true });
    bindCompactSongBarControls("#song-modal-cell", { stopPropagation: false });

    selectedSongBar
      .on("click", function(event) {
        if (event.target?.closest?.("button, input, a, select, textarea")) return;
        openSelectedSongContextCell();
      })
      .on("keydown", function(event) {
        if (event.target !== this) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        openSelectedSongContextCell();
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
    if (!genreHasSongs(gKey)) return;
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
          <span class="organized-group-arrow" aria-hidden="true"></span>
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
  let sorted = allGenresList.filter(genreHasSongs);

  if (genreSortMode === "az") {
    sorted.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  } else if (genreSortMode === "za") {
    sorted.sort((a, b) => b.toLowerCase().localeCompare(a.toLowerCase()));
  } else if (genreSortMode === "popular") {
    sorted.sort((a, b) => {
      const countA = sortGenresByVisible ? (visibleSongCountsCache.genres[a] || 0) : (genreCounts[a] || 0);
      const countB = sortGenresByVisible ? (visibleSongCountsCache.genres[b] || 0) : (genreCounts[b] || 0);
      const diff = countB - countA;
      if (diff !== 0) return diff; // primary: popularity

      if (sortGenresByVisible) {
        const totalA = genreCounts[a] || 0;
        const totalB = genreCounts[b] || 0;
        const diffTotal = totalB - totalA;
        if (diffTotal !== 0) return diffTotal; // secondary: total popularity
      }

      return a.toLowerCase().localeCompare(b.toLowerCase()); // tertiary: A-Z
    });
  } else if (genreSortMode === "unpopular") {
    sorted.sort((a, b) => {
      const countA = sortGenresByVisible ? (visibleSongCountsCache.genres[a] || 0) : (genreCounts[a] || 0);
      const countB = sortGenresByVisible ? (visibleSongCountsCache.genres[b] || 0) : (genreCounts[b] || 0);

      const diff = countA - countB;
      if (diff !== 0) return diff; // primary: least popular

      if (sortGenresByVisible) {
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
  const sortByVisibleHtml = genreListView === "all"
    ? renderSortByVisibleToggleHtml("genres", genreSortMode, sortGenresByVisible)
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
    <div class="panel-controls-row panel-controls-row--checkbox">
      <label class="must-contain-all-toggle">
        <input type="checkbox" id="genres-exclude-selected" ${showAllExcludingSelectedGenres ? "checked" : ""}>
        <span>Show all excluding selection</span>
      </label>
    </div>
  `;

  const genresBodyHtml = `
     ${renderPanelSelectedBlockHtml("genres")}
     <p class="panel-description">${genresDescription}</p>
     <div class="panel-controls-row">${viewButtonHtml}
       <button id="toggle-all-genres">${toggleAllLabel}</button>
       ${sortButtonHtml}
     </div>
     ${sortByVisibleHtml}
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

  bindPanelSelectedBlockInteractions("genres", {
    rerender: renderGenreListCell,
    containerSelector: "#genres-cell"
  });
  bindGenreViewDropdown();

  d3.select("#genres-must-contain-all").on("change", function() {
    mustContainAllSelectedGenres = !!this.checked;
    if (mustContainAllSelectedGenres) {
      showAllExcludingSelectedGenres = false;
      d3.select("#genres-exclude-selected").property("checked", false);
    }
    buildTable();
  });

  d3.select("#genres-exclude-selected").on("change", function() {
    showAllExcludingSelectedGenres = !!this.checked;
    if (showAllExcludingSelectedGenres) {
      mustContainAllSelectedGenres = false;
      d3.select("#genres-must-contain-all").property("checked", false);
    }
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
      showAllExcludingSelectedGenres = false;
      d3.select("#genres-must-contain-all").property("checked", false);
      d3.select("#genres-exclude-selected").property("checked", false);
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
    bindSortByVisibleToggle(
      "genres",
      (checked) => { sortGenresByVisible = checked; },
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
              <span class="organized-descriptor-subgroup-arrow" aria-hidden="true"></span>
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
          <span class="organized-descriptor-group-arrow" aria-hidden="true"></span>
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
      const countA = sortDescriptorsByVisible ? (visibleSongCountsCache.descriptors[a] || 0) : (descriptorCounts[a] || 0);
      const countB = sortDescriptorsByVisible ? (visibleSongCountsCache.descriptors[b] || 0) : (descriptorCounts[b] || 0);
      const diff = countB - countA;
      if (diff !== 0) return diff;

      if (sortDescriptorsByVisible) {
        const totalA = descriptorCounts[a] || 0;
        const totalB = descriptorCounts[b] || 0;
        const diffTotal = totalB - totalA;
        if (diffTotal !== 0) return diffTotal;
      }

      return getLabel(a).toLowerCase().localeCompare(getLabel(b).toLowerCase());
    });
  } else if (descriptorSortMode === "unpopular") {
    sorted.sort((a, b) => {
      const countA = sortDescriptorsByVisible ? (visibleSongCountsCache.descriptors[a] || 0) : (descriptorCounts[a] || 0);
      const countB = sortDescriptorsByVisible ? (visibleSongCountsCache.descriptors[b] || 0) : (descriptorCounts[b] || 0);

      const diff = countA - countB;
      if (diff !== 0) return diff;

      if (sortDescriptorsByVisible) {
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
  const sortByVisibleHtml = descriptorListView === "all"
    ? renderSortByVisibleToggleHtml("descriptors", descriptorSortMode, sortDescriptorsByVisible)
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
    <div class="panel-controls-row panel-controls-row--checkbox">
      <label class="must-contain-all-toggle">
        <input type="checkbox" id="descriptors-exclude-selected" ${showAllExcludingSelectedDescriptors ? "checked" : ""}>
        <span>Show all excluding selection</span>
      </label>
    </div>
  `;

  const descriptorsBodyHtml = `
     ${renderPanelSelectedBlockHtml("descriptors")}
     <p class="panel-description">${descriptorsDescription}</p>
     <div class="panel-controls-row">${viewButtonHtml}
       <button id="toggle-all-descriptors">${toggleAllLabel}</button>
       ${sortButtonHtml}
     </div>
     ${sortByVisibleHtml}
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

  bindPanelSelectedBlockInteractions("descriptors", {
    rerender: renderDescriptorsListCell,
    containerSelector: "#descriptors-cell"
  });

  bindDescriptorViewDropdown();

  d3.select("#descriptors-must-contain-all").on("change", function() {
    mustContainAllSelectedDescriptors = !!this.checked;
    if (mustContainAllSelectedDescriptors) {
      showAllExcludingSelectedDescriptors = false;
      d3.select("#descriptors-exclude-selected").property("checked", false);
    }
    buildTable();
  });

  d3.select("#descriptors-exclude-selected").on("change", function() {
    showAllExcludingSelectedDescriptors = !!this.checked;
    if (showAllExcludingSelectedDescriptors) {
      mustContainAllSelectedDescriptors = false;
      d3.select("#descriptors-must-contain-all").property("checked", false);
    }
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
    showAllExcludingSelectedDescriptors = false;
    d3.select("#descriptors-must-contain-all").property("checked", false);
    d3.select("#descriptors-exclude-selected").property("checked", false);
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
    bindSortByVisibleToggle(
      "descriptors",
      (checked) => { sortDescriptorsByVisible = checked; },
      renderDescriptorsListCell
    );
  }
}

function bindGenreClicks() { 
    d3.selectAll(".clickable-genre").on("click", function() { 
      showGenrePanel(d3.select(this).attr("data-genre"), true); 
    }); 
 
    d3.selectAll(".clickable-descriptor").on("click", function() { 
      showDescriptorPanel(d3.select(this).attr("data-descriptor"), true); 
    }); 

    d3.selectAll(".clickable-taxonomy").on("click", function() {
      showTaxonomyPanel(d3.select(this).attr("data-taxonomy"), true);
    });

    d3.selectAll(".clickable-country").on("click", function() { 
      showCountryPanel(d3.select(this).attr("data-country"), true); 
    }); 
 
    d3.selectAll(".clickable-artist").on("click", function() { 
      showArtistPanel(d3.select(this).attr("data-artist"), true); 
    }); 

    d3.selectAll(".genre-toggle").on("change", function(event) {
      event?.stopPropagation?.();
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

    d3.selectAll(".taxonomy-toggle").on("change", function(event) {
      event?.stopPropagation?.();
      const tKey = d3.select(this).attr("data-taxonomy");
      taxonomyVisibility[tKey] = this.checked;
      d3.selectAll(`.taxonomy-toggle[data-taxonomy="${tKey}"]`).property("checked", this.checked);
      buildTable();
      rerenderCurrentPanel(false);
      updateStatusBar();
      syncToggleAllButtonLabels();
    });

    d3.selectAll(".descriptor-toggle").on("change", function(event) {
      event?.stopPropagation?.();
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

    d3.selectAll(".country-toggle").on("change", function(event) {
      event?.stopPropagation?.();
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

    d3.selectAll(".artist-toggle").on("change", function(event) {
      event?.stopPropagation?.();
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
  d3.select("#genres-must-contain-all").property("checked", mustContainAllSelectedGenres);
  d3.select("#descriptors-must-contain-all").property("checked", mustContainAllSelectedDescriptors);
  d3.select("#genres-exclude-selected").property("checked", showAllExcludingSelectedGenres);
  d3.select("#descriptors-exclude-selected").property("checked", showAllExcludingSelectedDescriptors);
}

function showAllFilters() {
  clearChartNumberFilters();
  ratingMinFilter = 0.5;
  ratingMaxFilter = 5;
  lastClickedHistogramBin = null;
  mustContainAllSelectedGenres = false;
  mustContainAllSelectedDescriptors = false;
  showAllExcludingSelectedGenres = false;
  showAllExcludingSelectedDescriptors = false;
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
  clearChartNumberFilters();
  // "Show only" should also clear rating filters back to full range.
  ratingMinFilter = 0.5;
  ratingMaxFilter = 5;
  lastClickedHistogramBin = null;
  mustContainAllSelectedGenres = false;
  mustContainAllSelectedDescriptors = false;
  showAllExcludingSelectedGenres = false;
  showAllExcludingSelectedDescriptors = false;

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

function getSongTaxonomyForSide(song, side = "A") {
  const normalizedSide = (String(side || "A").toUpperCase() === "B") ? "B" : "A";
  if (normalizedSide === "B") return song?.taxonomyB || song?.genretaxonomy || "";
  return song?.genretaxonomy || "";
}

function getAllSongTaxonomies(song) {
  const set = new Set();
  const taxonomyA = getSongTaxonomyForSide(song, "A");
  const hasB = !!song?.tracks?.[1]?.youtubeId;
  const taxonomyB = hasB ? getSongTaxonomyForSide(song, "B") : "";
  if (taxonomyA) set.add(taxonomyA);
  if (taxonomyB) set.add(taxonomyB);
  return Array.from(set);
}

function getVisibleSongTaxonomies(song) {
  const visibleSides = getVisibleSidesForSong(song);
  const set = new Set();
  visibleSides.forEach((side) => {
    const taxKey = getSongTaxonomyForSide(song, side);
    if (taxKey) set.add(taxKey);
  });
  return Array.from(set);
}

function getSongTaxonomyForVisibleSides(song, visibleSides = getVisibleSidesForSong(song)) {
  if (Array.isArray(visibleSides) && visibleSides.length === 1) {
    return getSongTaxonomyForSide(song, visibleSides[0]);
  }
  return getSongTaxonomyForSide(song, "A");
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
  if (showAllExcludingSelectedGenres) {
    const selectedGenres = getSelectedGenreKeys();
    if (selectedGenres.length === 0) return true;
    const selectedGenreSet = new Set(selectedGenres);
    return !list.some(g => selectedGenreSet.has(g));
  }
  if (list.length === 0) return false;
  return list.some(g => genreVisibility[g]);
}

function songSideHasAnyVisibleDescriptor(song, side) {
  const descriptors = getSongDescriptorsForSide(song, side);
  if (showAllExcludingSelectedDescriptors) {
    const selectedDescriptors = getSelectedDescriptorKeys();
    if (selectedDescriptors.length === 0) return true;
    const selectedDescriptorSet = new Set(selectedDescriptors);
    return !(descriptors || []).some(d => selectedDescriptorSet.has(d));
  }
  if (!descriptors || descriptors.length === 0) return false;
  return descriptors.some(d => descriptorVisibility[d]);
}

function songSideHasVisibleTaxonomy(song, side) {
  const taxKey = getSongTaxonomyForSide(song, side);
  return !!taxKey && taxonomyVisibility[taxKey] !== false;
}

function isGenreFilterActive() {
  return (showAllExcludingSelectedGenres && getSelectedGenreKeys().length > 0) || !Object.values(genreVisibility).every(v => v);
}

function isDescriptorFilterActive() {
  const values = Object.values(descriptorVisibility);
  const anyVisible = values.some(v => v);
  const allVisible = values.every(v => v);
  return (showAllExcludingSelectedDescriptors && getSelectedDescriptorKeys().length > 0) || (anyVisible && !allVisible);
}

function isTaxonomyFilterActive() {
  const values = Object.values(taxonomyVisibility);
  const anyVisible = values.some(v => v);
  const allVisible = values.every(v => v);
  return anyVisible && !allVisible;
}

function getVisibleSidesForSong(song) {
  const hasB = !!song?.tracks?.[1]?.youtubeId;
  const taxonomyFilterActive = isTaxonomyFilterActive();
  const genreFilterActive = isGenreFilterActive();
  const descriptorFilterActive = isDescriptorFilterActive();
  const ratingFilterActive = ratingMinFilter > 0.5 || ratingMaxFilter < 5;
  const sideContentOk = (side) => {
    const taxonomyOk = !taxonomyFilterActive || songSideHasVisibleTaxonomy(song, side);
    const genreOk = !genreFilterActive || songSideHasAnyVisibleGenre(song, side);
    const descriptorOk = !descriptorFilterActive || songSideHasAnyVisibleDescriptor(song, side);
    return taxonomyOk && genreOk && descriptorOk;
  };
  
  if (!hasB) {
    if (!taxonomyFilterActive && !genreFilterActive && !descriptorFilterActive && !ratingFilterActive) return ["A"];

    const aContentOk = sideContentOk("A");

    let aRatingOk = true;
    if (ratingFilterActive) {
      const sideARating = getSongRatingScoreForSide(song, "A");
      const aHasRating = sideARating !== null && Number.isFinite(Number(sideARating));
      aRatingOk = aHasRating && sideARating >= ratingMinFilter && sideARating <= ratingMaxFilter;
    }

    return (aContentOk && aRatingOk) ? ["A"] : [];
  }

  if (!taxonomyFilterActive && !genreFilterActive && !descriptorFilterActive && !ratingFilterActive) return ["A", "B"];

  // If genre/descriptor filters are inactive, both sides are "content-visible" by default.
  const aContentOk = sideContentOk("A");
  const bContentOk = sideContentOk("B");

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

function getSongSidesContainingTaxonomy(song, taxonomyKey) {
  const key = String(taxonomyKey || "").trim().toLowerCase();
  if (!key) return [];

  const hasB = !!song?.tracks?.[1]?.youtubeId;
  const sides = [];
  (hasB ? ["A", "B"] : ["A"]).forEach((side) => {
    const taxKey = getSongTaxonomyForSide(song, side);
    if (String(taxKey || "").toLowerCase() === key) sides.push(side);
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

function normalizeYouTubeId(value) {
  return String(value || "").trim();
}

function findChartTrackByYouTubeId(youtubeId) {
  const targetId = normalizeYouTubeId(youtubeId);
  if (!targetId) return null;

  for (const song of songs) {
    const tracks = Array.isArray(song?.tracks) ? song.tracks : [];
    for (let i = 0; i < tracks.length; i += 1) {
      if (normalizeYouTubeId(tracks[i]?.youtubeId) === targetId) {
        return {
          song,
          side: i === 1 ? "B" : "A",
          track: tracks[i]
        };
      }
    }
  }

  return null;
}

function getOriginalVersionForSong(song, side = "A") {
  if (!song) return null;
  const normalizedSide = String(side || "A").toUpperCase() === "B" ? "B" : "A";

  const coverCandidate = normalizedSide === "B"
    ? {
        type: "cover",
        title: song.covertitleB,
        youtubeId: song.coveryoutubeidB,
        artist: song.coverartistB,
        country: song.covercountryB
      }
    : {
        type: "cover",
        title: song.covertitle,
        youtubeId: song.coveryoutubeid,
        artist: song.coverartist,
        country: song.covercountry
      };

  const candidates = [
    coverCandidate,
    {
      type: "remix",
      title: song.remixtitle,
      youtubeId: song.remixyoutubeid,
      artist: song.remixartist,
      country: song.remixcountry
    }
  ];

  for (const candidate of candidates) {
    const youtubeId = normalizeYouTubeId(candidate.youtubeId);
    if (!youtubeId) continue;

    const match = findChartTrackByYouTubeId(youtubeId);
    const matchedArtists = match ? getArtistsForSide(match.song, match.side) : [];
    const matchedArtistText = matchedArtists.map(d => d.artist).filter(Boolean).join(getSongArtistSeparator(match?.song));
    const matchedCountryText = matchedArtists.map(d => d.country).filter(Boolean)[0] || "";
    const title = match?.track?.title || String(candidate.title || "").trim() || "";
    const artist = matchedArtistText || String(candidate.artist || "").trim();

    if (!title && !artist && !match) continue;

    return {
      ...candidate,
      title: title || "Original version",
      youtubeId,
      artist,
      country: matchedCountryText || String(candidate.country || "").trim(),
      sourceSong: match?.song || null,
      sourceSide: match?.side || "A",
      sourceTrack: match?.track || null
    };
  }

  return null;
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
  const fullLimit = Number.MAX_SAFE_INTEGER;
  const topChartSongs = getTopChartingSongs(songsList, fullLimit, options);
  const topRatedSongs = getTopRatedSongs(songsList, fullLimit, options);
  return buildTopSongsSectionHtml(topChartSongs, topRatedSongs, options);
}

function buildTopSongsSectionHtml(topChartSongs, topRatedSongs, options = {}) {
  const resolveSides = typeof options.resolveSides === "function"
    ? options.resolveSides
    : (song) => getVisibleSidesForSong(song);

  const selectedMode = options.mode === "ratings" || topSongsMode === "ratings" ? "ratings" : "chart";

  const chartRowsHtml = buildTopSongRowsHtml(topChartSongs, "chart", resolveSides);
  const ratingRowsHtml = buildTopSongRowsHtml(topRatedSongs, "ratings", resolveSides);
  const chartToggleHtml = topChartSongs.length > 3
    ? `<button type="button" class="top-songs-show-all" data-top-songs-show-all="chart" style="display:${selectedMode === "chart" ? "" : "none"}" aria-expanded="false">Show all</button>`
    : "";
  const ratingsToggleHtml = topRatedSongs.length > 3
    ? `<button type="button" class="top-songs-show-all" data-top-songs-show-all="ratings" style="display:${selectedMode === "ratings" ? "" : "none"}" aria-expanded="false">Show all</button>`
    : "";

  const chartContentHtml = chartRowsHtml.length
    ? `<ol class="top-songs-list top-songs-list--chart" data-top-songs-list="chart" style="display:${selectedMode === "chart" ? "" : "none"}">${chartRowsHtml}</ol>${chartToggleHtml}`
    : `<p class="top-songs-empty top-songs-empty--chart" style="display:${selectedMode === "chart" ? "" : "none"}">No songs found.</p>`;

  const ratingsContentHtml = ratingRowsHtml.length
    ? `<ol class="top-songs-list top-songs-list--ratings" data-top-songs-list="ratings" style="display:${selectedMode === "ratings" ? "" : "none"}">${ratingRowsHtml}</ol>${ratingsToggleHtml}`
    : `<p class="top-songs-empty top-songs-empty--ratings" style="display:${selectedMode === "ratings" ? "" : "none"}">No rated songs found.</p>`;

  return `
    <div class="top-songs-section">
      ${buildSelectedSectionDividerHtml("Top Songs")}
      <div class="top-songs-section-header">
        <div class="sort-dropdown top-songs-mode-dropdown" data-sort-dropdown="top-songs">
          <button type="button" class="sort-dropdown-trigger" aria-haspopup="true" aria-expanded="false">
            ${selectedMode === "ratings" ? "Ratings" : "Chart"} ${getDropdownIconHtml()}
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
  return list.map((song, index) => {
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
      if (Number.isFinite(Number(peak)) && Number(peak) > 1) metaParts.push(`Peak #${peak}`);
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
        ? `${score.toFixed(2)} / ${votes} rating${votes === 1 ? "" : "s"}`
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
      <li class="top-song-row${index >= 3 ? " top-song-row--extra" : ""}">
        <div class="top-song-row-content">
          <span class="top-song-rank" aria-hidden="true">${index + 1}.</span>
          <div class="top-song-main">
            <div class="top-song-title">
              ${titleButtonsHtml}
            </div>
            ${artistRowHtml}
            <span class="top-song-meta">${metaText}</span>
          </div>
        </div>
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

      trigger.html(`${mode === "ratings" ? "Ratings" : "Chart"} ${getDropdownIconHtml()}`);
      dropdown.attr("data-top-songs-mode", mode);

      const parent = dropdown.node().closest(".top-songs-section");
      if (!parent) return;
      const section = d3.select(parent);

      section.selectAll(".top-songs-list").style("display", "none");
      section.selectAll(".top-songs-disclaimer").style("display", "none");
      section.selectAll(".top-songs-empty").style("display", "none");
      section.selectAll(".top-songs-show-all").style("display", "none");

      section.select(`.top-songs-list--${mode}`).style("display", null);
      section.select(`.top-songs-disclaimer--${mode}`).style("display", null);
      section.select(`[data-top-songs-show-all="${mode}"]`).style("display", null);
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

  root.selectAll(".top-songs-show-all").on("click", function(event) {
    event.preventDefault();
    event.stopPropagation();

    const button = d3.select(this);
    const mode = button.attr("data-top-songs-show-all");
    const sectionNode = this.closest(".top-songs-section");
    if (!mode || !sectionNode) return;

    const section = d3.select(sectionNode);
    const list = section.select(`[data-top-songs-list="${mode}"]`);
    if (list.empty()) return;

    const nextExpanded = !list.classed("is-expanded");
    list.classed("is-expanded", nextExpanded);
    button
      .attr("aria-expanded", nextExpanded ? "true" : "false")
      .text(nextExpanded ? "Show less" : "Show all");
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
  const hadYearFilter = hasAnySelectedValue(selectedYear);
  const hadRankFilter = hasAnySelectedValue(selectedRank);
  if (hadYearFilter || hadRankFilter) {
    clearChartNumberFilters();
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
    if (isMobileOverlayMode()) {
      openSelectedSongContextCell();
      if (typeof window.__goaScrollContextPanelToTop === "function") {
        window.__goaScrollContextPanelToTop("#song-modal-cell");
      }
    }
  });
}

function buildSelectedSectionDividerHtml(label) {
  return `
    <div class="selected-section-divider" aria-hidden="true">
      <span>${label}</span>
    </div>
  `;
}

function showTaxonomyPanel(taxKey, resetScroll = true, forceOpen = true) { 
  if (forceOpen) accordionState.categories = true; 
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

    const relatedSectionHtml = relatedHtml ? `${buildSelectedSectionDividerHtml("Key Genres")}<ul>${relatedHtml}</ul>` : "";
    const taxonomyCountTotal = songs.filter(s => getAllSongTaxonomies(s).includes(taxKey)).length;
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
    const taxonomySongs = songs.filter(s => s && getAllSongTaxonomies(s).includes(taxKey));
    const topTaxSongsSectionHtml = buildTopSongsSectionHtmlForItem(taxonomySongs, {
      resolveSides: (song) => getSongSidesContainingTaxonomy(song, taxKey)
    });

    const infoBodyHtml = `
      <button type="button" class="selected-only-toggle" data-only-type="taxonomy" data-taxonomy="${taxKey}">${taxonomyOnlyLabel}</button>
      <p>${info.description || ""}</p>
      ${relatedSectionHtml ? `<br>${relatedSectionHtml}` : ""}
      ${topTaxSongsSectionHtml}
    `;

    panelSelectedState.categories = {
      headerMetaHtml,
      bodyHtml: infoBodyHtml,
      headerBorderColor: info.color
    };

    if (forceOpen) {
      setActiveContextPanel("categories");
      renderCategoriesPanel();
      if (resetScroll) {
        queueContextPanelScrollToTop("#categories-cell");
      }
    } else {
      refreshRenderedContextPanels({ preserveScroll: true });
    }
  }

  // Genre side panel 

  function showGenrePanel(genreKey, resetScroll = true, forceOpen = true) {
    if (forceOpen) accordionState.genres = true;

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

      panelSelectedState.genres = {
        headerMetaHtml,
        bodyHtml: infoBodyHtml
      };

      if (forceOpen) {
        setActiveContextPanel("genres");
        renderGenreListCell();
        if (resetScroll) {
          queueContextPanelScrollToTop("#genres-cell");
        }
      } else {
        refreshRenderedContextPanels({ preserveScroll: true });
      }
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

    const relatedSectionHtml = relatedHtml ? `${buildSelectedSectionDividerHtml("Related Genres")}<ul>${relatedHtml}</ul>` : "";
    const externalLinkIconHtml = `
      <svg class="external-link-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M7 17 17 7"></path>
        <path d="M9 7h8v8"></path>
      </svg>
    `;
    const buildLearnMoreLinkHtml = (href, label) => href
      ? `<li><a class="external-link" href="${href}" target="_blank" rel="noopener noreferrer"><span>${label}</span>${externalLinkIconHtml}</a></li>`
      : "";
    const learnMoreLinks = [
      buildLearnMoreLinkHtml(g.link, "Rate Your Music"),
      buildLearnMoreLinkHtml(g.wikipedia, "Wikipedia")
    ].filter(Boolean).join("");
    const learnMoreSectionHtml = learnMoreLinks ? `${buildSelectedSectionDividerHtml("Learn More")}<ul>${learnMoreLinks}</ul>` : "";

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
      ${relatedSectionHtml ? `<br>${relatedSectionHtml}` : ""}
      ${learnMoreSectionHtml ? `<br>${learnMoreSectionHtml}` : ""}
      ${buildTopSongsSectionHtmlForItem(
        songs.filter(s => songHasGenre(s, resolvedKey)),
        { resolveSides: (song) => getSongSidesContainingGenre(song, resolvedKey) }
      )}
    `;

    panelSelectedState.genres = {
      headerMetaHtml,
      bodyHtml: infoBodyHtml,
      headerBorderColor: taxInfo?.color || ""
    };

    if (forceOpen) {
      setActiveContextPanel("genres");
      renderGenreListCell();
      if (resetScroll) {
        queueContextPanelScrollToTop("#genres-cell");
      }
    } else {
      refreshRenderedContextPanels({ preserveScroll: true });
    }
  }



  function showDescriptorPanel(descriptorKey, resetScroll = true, forceOpen = true) {
    if (forceOpen) accordionState.descriptors = true;

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

    panelSelectedState.descriptors = {
      headerMetaHtml,
      bodyHtml: infoBodyHtml
    };

    if (forceOpen) {
      setActiveContextPanel("descriptors");
      renderDescriptorsListCell();
      if (resetScroll) {
        queueContextPanelScrollToTop("#descriptors-cell");
      }
    } else {
      refreshRenderedContextPanels({ preserveScroll: true });
    }
  }

  function showCountryPanel(countryCode, resetScroll = true, forceOpen = true) { 
    if (forceOpen) accordionState.countries = true; 
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

    panelSelectedState.countries = {
      headerMetaHtml,
      bodyHtml: infoBodyHtml
    };

    if (forceOpen) {
      setActiveContextPanel("countries");
      renderCountriesPanel();
      if (resetScroll) {
        queueContextPanelScrollToTop("#countries-cell");
      }
    } else {
      refreshRenderedContextPanels({ preserveScroll: true });
    }
  }

  function showArtistPanel(artistName, resetScroll = true, forceOpen = true) { 
    if (forceOpen) accordionState.artists = true; 
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

    panelSelectedState.artists = {
      headerMetaHtml,
      bodyHtml: infoBodyHtml
    };

    if (forceOpen) {
      setActiveContextPanel("artists");
      renderArtistsPanel();
      if (resetScroll) {
        queueContextPanelScrollToTop("#artists-cell");
      }
    } else {
      refreshRenderedContextPanels({ preserveScroll: true });
    }
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
    if (typeof window.__goaUpdateContextColumn === "function") {
      window.__goaUpdateContextColumn();
    }

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

    // Reset scroll when clicking a selected item inside the mobile overlay.
    overlayPanel.addEventListener('click', function(e) {
      const selectedItem = e.target.closest('.clickable-genre, .clickable-descriptor, .clickable-taxonomy, .clickable-country, .clickable-artist');
      if (!selectedItem || !overlayPanel.contains(selectedItem)) return;

      if (typeof window.__goaScrollContextPanelToTop === "function") {
        window.__goaScrollContextPanelToTop();
      }
    });

});

const contextColumn = document.querySelector(".context-column");
const contextNav = document.querySelector(".context-nav");
const contextPanels = document.querySelector(".context-panels");
const headerContent = document.querySelector(".header-content");
const overlayPanel = document.querySelector(".menu-overlay-panel");
const mainContainer = document.querySelector(".main-container");
const chartArea = document.querySelector(".chart-area");
const panelResizer = document.querySelector(".panel-resizer");
let minSidePanelWidth = null;
const minChartWidth = 520;

function isDesktopSidePanelLayout() {
  return window.innerWidth > 1100;
}

function getPanelResizerWidth() {
  return panelResizer ? panelResizer.getBoundingClientRect().width : 0;
}

function ensureMinSidePanelWidth() {
  if (!contextColumn || !isDesktopSidePanelLayout()) return 0;
  if (minSidePanelWidth === null) {
    minSidePanelWidth = Math.round(contextColumn.getBoundingClientRect().width);
  }
  return minSidePanelWidth || 0;
}

function getMaxSidePanelWidth() {
  if (!mainContainer) return ensureMinSidePanelWidth();
  const availableWidth = mainContainer.getBoundingClientRect().width - getPanelResizerWidth();
  const maxFromChart = Math.max(ensureMinSidePanelWidth(), availableWidth - minChartWidth);
  return Math.min(4000, maxFromChart);
}

function setSidePanelWidth(width) {
  if (!contextColumn || !chartArea || !isDesktopSidePanelLayout()) return;
  const minWidth = ensureMinSidePanelWidth();
  const maxWidth = getMaxSidePanelWidth();
  const nextWidth = Math.round(Math.min(Math.max(width, minWidth), maxWidth));
  contextColumn.style.flex = `0 0 ${nextWidth}px`;
  contextColumn.style.width = `${nextWidth}px`;
  chartArea.style.flex = "1 1 auto";
  chartArea.style.width = "";
  panelResizer?.setAttribute("aria-valuemin", String(minWidth));
  panelResizer?.setAttribute("aria-valuemax", String(maxWidth));
  panelResizer?.setAttribute("aria-valuenow", String(nextWidth));
}

function resetDesktopResizeStylesForMobile() {
  if (isDesktopSidePanelLayout()) return;
  if (contextColumn) {
    contextColumn.style.flex = "";
    contextColumn.style.width = "";
  }
  if (chartArea) {
    chartArea.style.flex = "";
    chartArea.style.width = "";
  }
}

function initPanelResizer() {
  if (!panelResizer || !contextColumn || !chartArea || !mainContainer) return;

  panelResizer.addEventListener("pointerdown", (event) => {
    if (!isDesktopSidePanelLayout()) return;
    event.preventDefault();
    ensureMinSidePanelWidth();

    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startWidth = contextColumn.getBoundingClientRect().width;
    panelResizer.setPointerCapture?.(pointerId);
    document.body.classList.add("is-resizing-side-panel");

    const onPointerMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX;
      setSidePanelWidth(startWidth + deltaX);
    };

    const stopDrag = (upEvent) => {
      panelResizer.removeEventListener("pointermove", onPointerMove);
      panelResizer.removeEventListener("pointerup", stopDrag);
      panelResizer.removeEventListener("pointercancel", stopDrag);
      panelResizer.releasePointerCapture?.(upEvent.pointerId);
      document.body.classList.remove("is-resizing-side-panel");
      window.dispatchEvent(new Event("resize"));
    };

    panelResizer.addEventListener("pointermove", onPointerMove);
    panelResizer.addEventListener("pointerup", stopDrag);
    panelResizer.addEventListener("pointercancel", stopDrag);
  });

  panelResizer.addEventListener("keydown", (event) => {
    if (!isDesktopSidePanelLayout()) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const currentWidth = contextColumn.getBoundingClientRect().width;
    const step = event.shiftKey ? 40 : 16;
    setSidePanelWidth(currentWidth + (event.key === "ArrowRight" ? step : -step));
    window.dispatchEvent(new Event("resize"));
  });
}

function moveContextColumn() {
  const isMobile = !isDesktopSidePanelLayout();
  if (isMobile) {
    if (contextNav && headerContent && contextNav.parentElement !== headerContent) {
      headerContent.appendChild(contextNav);
    }
    if (!overlayPanel.contains(contextColumn)) {
      overlayPanel.appendChild(contextColumn);
    }
  } else {
    if (contextNav && contextPanels && contextNav.parentElement !== contextColumn) {
      contextColumn.insertBefore(contextNav, contextPanels);
    }
    if (!mainContainer.contains(contextColumn)) {
      mainContainer.insertBefore(contextColumn, mainContainer.firstChild);
    }
  }

  // Ensure the overlay can't remain open when switching back to desktop layout.
  if (!isMobile && typeof window.__goaSetMenuOpen === "function") {
    window.__goaSetMenuOpen(false, { resetScroll: false });
  }

  resetDesktopResizeStylesForMobile();
  if (!isMobile && contextColumn?.style.width) {
    setSidePanelWidth(parseFloat(contextColumn.style.width));
  }
}

window.addEventListener("resize", moveContextColumn);
window.addEventListener("DOMContentLoaded", moveContextColumn);
initPanelResizer();
})();

// VS Code-style overlay scrollbars for the app's custom scroll surfaces.
(function() {
const SCROLL_TARGET_SELECTOR = [
  ".chart-grid-scroller",
  ".context-column",
  ".context-panels",
  ".context-panels .accordion-body",
  "#song-modal-cell .song-body-content",
  ".menu-overlay",
  ".menu-overlay-panel",
  ".menu-overlay-panel .context-column"
].join(",");

const MIN_THUMB_SIZE = 28;
const BAR_SIZE = 10;
const instances = new Map();
let resizeObserver = null;
let scanQueued = false;
let updateQueued = false;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function createScrollbar(axis) {
  const bar = document.createElement("div");
  bar.className = `goa-overlay-scrollbar goa-overlay-scrollbar--${axis}`;
  bar.setAttribute("aria-hidden", "true");

  const thumb = document.createElement("div");
  thumb.className = "goa-overlay-scrollbar__thumb";
  bar.appendChild(thumb);
  document.body.appendChild(bar);

  return { bar, thumb };
}

function createInstance(target) {
  const vertical = createScrollbar("vertical");
  const horizontal = createScrollbar("horizontal");
  const instance = {
    target,
    vertical,
    horizontal,
    hideTimer: null,
    isPointerInside: false,
    isDragging: false
  };

  target.addEventListener("scroll", () => {
    showInstance(instance);
    queueUpdate();
  }, { passive: true });

  target.addEventListener("pointerenter", () => {
    instance.isPointerInside = true;
    showInstance(instance);
  });

  target.addEventListener("pointerleave", () => {
    instance.isPointerInside = false;
    scheduleHide(instance);
  });

  [vertical.bar, horizontal.bar].forEach((bar) => {
    bar.addEventListener("pointerenter", () => {
      instance.isPointerInside = true;
      showInstance(instance);
    });
    bar.addEventListener("pointerleave", () => {
      instance.isPointerInside = false;
      scheduleHide(instance);
    });
  });

  bindDrag(instance, "vertical");
  bindDrag(instance, "horizontal");

  if (resizeObserver) resizeObserver.observe(target);
  instances.set(target, instance);
  updateInstance(instance);
}

function removeInstance(target, instance) {
  if (resizeObserver) resizeObserver.unobserve(target);
  instance.vertical.bar.remove();
  instance.horizontal.bar.remove();
  instances.delete(target);
}

function bindDrag(instance, axis) {
  const scrollbar = instance[axis];
  const isVertical = axis === "vertical";

  scrollbar.bar.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "touch") return;
    if (event.target !== scrollbar.bar) return;

    const target = instance.target;
    const barRect = scrollbar.bar.getBoundingClientRect();
    const pointer = isVertical ? event.clientY - barRect.top : event.clientX - barRect.left;
    const scrollSize = isVertical ? target.scrollHeight : target.scrollWidth;
    const clientSize = isVertical ? target.clientHeight : target.clientWidth;
    const trackSize = isVertical ? scrollbar.bar.offsetHeight : scrollbar.bar.offsetWidth;
    const thumbSize = isVertical ? scrollbar.thumb.offsetHeight : scrollbar.thumb.offsetWidth;
    const maxScroll = Math.max(1, scrollSize - clientSize);
    const maxThumbTravel = Math.max(1, trackSize - thumbSize);
    const nextScroll = ((pointer - (thumbSize / 2)) / maxThumbTravel) * maxScroll;

    event.preventDefault();
    showInstance(instance);
    if (isVertical) {
      target.scrollTop = nextScroll;
    } else {
      target.scrollLeft = nextScroll;
    }
    queueUpdate();
  });

  scrollbar.thumb.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();

    const target = instance.target;
    const startPointer = isVertical ? event.clientY : event.clientX;
    const startScroll = isVertical ? target.scrollTop : target.scrollLeft;
    const scrollSize = isVertical ? target.scrollHeight : target.scrollWidth;
    const clientSize = isVertical ? target.clientHeight : target.clientWidth;
    const trackSize = isVertical ? scrollbar.bar.offsetHeight : scrollbar.bar.offsetWidth;
    const thumbSize = isVertical ? scrollbar.thumb.offsetHeight : scrollbar.thumb.offsetWidth;
    const maxScroll = Math.max(1, scrollSize - clientSize);
    const maxThumbTravel = Math.max(1, trackSize - thumbSize);
    const scrollPerPixel = maxScroll / maxThumbTravel;

    instance.isDragging = true;
    showInstance(instance);
    scrollbar.bar.classList.add("is-dragging");
    scrollbar.thumb.setPointerCapture?.(event.pointerId);

    function onPointerMove(moveEvent) {
      moveEvent.preventDefault();
      const pointer = isVertical ? moveEvent.clientY : moveEvent.clientX;
      const nextScroll = startScroll + ((pointer - startPointer) * scrollPerPixel);
      if (isVertical) {
        target.scrollTop = nextScroll;
      } else {
        target.scrollLeft = nextScroll;
      }
      queueUpdate();
    }

    function onPointerUp(upEvent) {
      instance.isDragging = false;
      scrollbar.bar.classList.remove("is-dragging");
      scrollbar.thumb.releasePointerCapture?.(upEvent.pointerId);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      scheduleHide(instance);
    }

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp, { once: true });
  });
}

function showInstance(instance) {
  clearTimeout(instance.hideTimer);
  updateInstance(instance);
  instance.vertical.bar.classList.add("is-visible");
  instance.horizontal.bar.classList.add("is-visible");
  scheduleHide(instance);
}

function scheduleHide(instance) {
  clearTimeout(instance.hideTimer);
  if (instance.isDragging || instance.isPointerInside) return;

  instance.hideTimer = setTimeout(() => {
    instance.vertical.bar.classList.remove("is-visible");
    instance.horizontal.bar.classList.remove("is-visible");
  }, 850);
}

function isUsableTarget(target) {
  if (!document.body.contains(target)) return false;
  const rect = target.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return false;
  const style = window.getComputedStyle(target);
  return style.display !== "none" && style.visibility !== "hidden";
}

function updateInstance(instance) {
  const target = instance.target;
  const rect = target.getBoundingClientRect();
  const hasVertical = target.scrollHeight > target.clientHeight + 1;
  const hasHorizontal = target.scrollWidth > target.clientWidth + 1;
  const canRender = isUsableTarget(target);

  updateAxis(instance, "vertical", rect, hasVertical && canRender, hasHorizontal);
  updateAxis(instance, "horizontal", rect, hasHorizontal && canRender, hasVertical);
}

function updateAxis(instance, axis, rect, shouldShow, hasOtherAxis) {
  const target = instance.target;
  const scrollbar = instance[axis];
  const isVertical = axis === "vertical";

  if (!shouldShow) {
    scrollbar.bar.style.display = "none";
    scrollbar.bar.classList.remove("is-visible", "is-dragging");
    return;
  }

  const trackLength = Math.max(0, (isVertical ? rect.height : rect.width) - (hasOtherAxis ? BAR_SIZE : 0));
  const clientSize = isVertical ? target.clientHeight : target.clientWidth;
  const scrollSize = isVertical ? target.scrollHeight : target.scrollWidth;
  const scrollPosition = isVertical ? target.scrollTop : target.scrollLeft;
  const maxScroll = Math.max(1, scrollSize - clientSize);
  const thumbLength = clamp((clientSize / scrollSize) * trackLength, MIN_THUMB_SIZE, trackLength);
  const thumbOffset = ((trackLength - thumbLength) * scrollPosition) / maxScroll;

  scrollbar.bar.style.display = "block";

  if (isVertical) {
    scrollbar.bar.style.left = `${Math.round(rect.right - BAR_SIZE)}px`;
    scrollbar.bar.style.top = `${Math.round(rect.top)}px`;
    scrollbar.bar.style.width = `${BAR_SIZE}px`;
    scrollbar.bar.style.height = `${Math.round(trackLength)}px`;
    scrollbar.thumb.style.left = "";
    scrollbar.thumb.style.top = `${thumbOffset}px`;
    scrollbar.thumb.style.width = "";
    scrollbar.thumb.style.height = `${thumbLength}px`;
  } else {
    scrollbar.bar.style.left = `${Math.round(rect.left)}px`;
    scrollbar.bar.style.top = `${Math.round(rect.bottom - BAR_SIZE)}px`;
    scrollbar.bar.style.width = `${Math.round(trackLength)}px`;
    scrollbar.bar.style.height = `${BAR_SIZE}px`;
    scrollbar.thumb.style.left = `${thumbOffset}px`;
    scrollbar.thumb.style.top = "";
    scrollbar.thumb.style.width = `${thumbLength}px`;
    scrollbar.thumb.style.height = "";
  }
}

function queueUpdate() {
  if (updateQueued) return;
  updateQueued = true;
  requestAnimationFrame(() => {
    updateQueued = false;
    instances.forEach((instance, target) => {
      if (!document.body.contains(target)) {
        removeInstance(target, instance);
      } else {
        updateInstance(instance);
      }
    });
  });
}

function queueScan() {
  if (scanQueued) return;
  scanQueued = true;
  requestAnimationFrame(() => {
    scanQueued = false;
    scanTargets();
  });
}

function scanTargets() {
  document.querySelectorAll(SCROLL_TARGET_SELECTOR).forEach((target) => {
    if (!instances.has(target)) createInstance(target);
  });

  instances.forEach((instance, target) => {
    if (!document.body.contains(target) || !target.matches(SCROLL_TARGET_SELECTOR)) {
      removeInstance(target, instance);
    }
  });

  queueUpdate();
}

function initOverlayScrollbars() {
  if (resizeObserver === null && "ResizeObserver" in window) {
    resizeObserver = new ResizeObserver(queueUpdate);
  }

  scanTargets();

  const mutationObserver = new MutationObserver((mutations) => {
    const shouldScan = mutations.some((mutation) => {
      const target = mutation.target;
      return target instanceof Element && !target.closest(".goa-overlay-scrollbar");
    });
    if (shouldScan) queueScan();
  });
  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style"]
  });

  window.addEventListener("resize", () => {
    queueScan();
    queueUpdate();
  });
  window.addEventListener("scroll", queueUpdate, { passive: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initOverlayScrollbars);
} else {
  initOverlayScrollbars();
}
})();
