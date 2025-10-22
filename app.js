d3.json("./songs.json").then(dataset => {
  const songs = dataset.songs;
  const taxonomy = dataset.taxonomy || {};
  const genres = dataset.genres || {};

  let currentSongList = [];
  let sortMode = "genre"; // chart
  let currentPanel = { type: null, key: null };
  let genreSortMode = "popular"; // az, za, popular, unpopular
  let countrySortMode = "popular";  // az, za, popular, unpopular
  let artistSortMode = "popular";

  d3.selectAll("input[name=sortMode]").property("checked", function() {
  return this.value === sortMode;
});

  const years = Array.from(new Set(songs.map(d => d.chartYear))).sort((a, b) => a - b);
  const ranks = d3.range(1, 11);
  const taxonomyOrder = ["hiphop","dance","soulrnb","rock","countryfolk","jazztraditionalpop"];

  // Collect all genres (primary + subgenres)
  const allGenresSet = new Set();
  songs.forEach(s => {
    if (s.primarygenre) allGenresSet.add(s.primarygenre);
    if (Array.isArray(s.subgenres)) s.subgenres.forEach(g => allGenresSet.add(g));
  });
  const allGenresList = Array.from(allGenresSet).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  // Count how many times each genre appears (primary or sub)
  let genreCounts = {};
  songs.forEach(s => {
    [s.primarygenre, ...(s.subgenres || [])].forEach(g => {
      if (!g) return;
      genreCounts[g] = (genreCounts[g] || 0) + 1;
    });
  });
  
  // Track visibility state
  let genreVisibility = {};
  allGenresList.forEach(g => { genreVisibility[g] = true; });

  let taxonomyVisibility = {};
  Object.keys(taxonomy).forEach(t => { taxonomyVisibility[t] = true; });

  // Track visibility for countries and artists
  // false by default for better user experience
  let countryVisibility = {};
  let artistVisibility = {};
  songs.forEach(s => {
    (s.countryCode || []).forEach(c => { countryVisibility[c] = false; });
    (s.artists || []).forEach(a => { artistVisibility[a] = false; });
  });

  // Tooltip
  const tooltip = d3.select("body").append("div").attr("id", "tooltip");

  // Legend (Taxonomy labels)
  const legend = d3.select(".legend");
  Object.entries(taxonomy).forEach(([key, info]) => {
    legend.append("span")
      .attr("class", "genre-badge clickable-taxonomy")
      .style("border", `2px solid ${info.color}`)
      .attr("data-taxonomy", key)
      .text(info.label)
      .on("click", () => showTaxonomyPanel(key))
      .append("title")
      .text(info.description || "");
  });

  // Sort controls
  d3.selectAll("input[name=sortMode]").on("change", function() {
    sortMode = this.value;
    buildTable();
  });

  // Side panel close
  d3.select("#side-panel-close").on("click", () => closeSidePanel());
  d3.select("#side-panel").on("click", function(event) {
    if (event.target.id === "side-panel") closeSidePanel();
  });

  // Modal close
  d3.select("#modal-close").on("click", () => {
    d3.selectAll("#video-container iframe").attr("src", "");
    d3.select("#modal").style("display", "none");
  });
  d3.select("#modal").on("click", function(event) {
    if (event.target.id === "modal") {
      d3.selectAll("#video-container iframe").attr("src", "");
      d3.select("#modal").style("display", "none");
    }
  });

  // Table
  const table = d3.select(".chart-container").append("table").attr("class", "chart-table");
  const tbody = table.append("tbody");

  buildTable();
  function buildTable() {
    tbody.html("");
    currentSongList = [];

    if (sortMode === "chart") {
      // Chart mode: strict rank order
      const rowMap = {};
      ranks.forEach(rank => {
        rowMap[rank] = tbody.append("tr");
        years.forEach(year => {
          const song = songs.find(d => d.chartYear === year && d.rank === rank);
          appendCell(rowMap[rank], song);
        });
      });
      years.forEach(year => {
        ranks.forEach(rank => {
          const song = songs.find(d => d.chartYear === year && d.rank === rank);
          if (song) currentSongList.push(song);
        });
      });
    } else {
      // Taxonomy mode: visible songs pinned to bottom
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

        // Hidden first, visible last → visible pinned to bottom
        songsByYear[year] = [...hidden, ...visible];
      });
      // Determine max rows needed (longest year column)
      const maxRows = d3.max(Object.values(songsByYear), arr => arr.length) || 0;
      // Build table row by row
      for (let rowIndex = 0; rowIndex < maxRows; rowIndex++) {
        const tr = tbody.append("tr");
        years.forEach(year => {
          const song = songsByYear[year][rowIndex];
          appendCell(tr, song);
        });
      }
      // Build navigation order (column-major)
      years.forEach(year => {
        for (let rowIndex = 0; rowIndex < maxRows; rowIndex++) {
          const song = songsByYear[year][rowIndex];
          if (song) currentSongList.push(song);
        }
      });
    }
  // Add timeline row (everyime the table rebuilds itself)
const timelineRow = tbody.append("tr").attr("class", "timeline-row");

years.forEach((year, i) => {
  const cell = timelineRow.append("td")
    .attr("class", "timeline-cell");

  // Always draw a notch 
  cell.append("div")
    .attr("class", "timeline-notch");

  // Add label if it's the first year, last year, or a decade
  if (year === years[0] || year === years[years.length - 1] || year % 10 === 0) {
    cell.append("div")
      .attr("class", "timeline-label")
      .text(year);
  }
});
  }

// Check if a song should be visible (genres + taxonomies)
function isSongVisible(song) {
  const songGenres = [song.primarygenre, ...(song.subgenres || [])];
  const songCountries = song.countryCode || [];
  const songArtists = song.artists || [];

  const anyTaxChecked = Object.values(taxonomyVisibility).some(v => v);
  const anyGenreChecked = Object.values(genreVisibility).some(v => v);
  const anyCountryChecked = Object.values(countryVisibility).some(v => v);
  const anyArtistChecked = Object.values(artistVisibility).some(v => v);

  // Genre + taxonomy filtering
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

  // Append a single table cell for a song
  function appendCell(row, song) {
    const cell = row.append("td").attr("class", "chart-cell").classed("empty", !song);
    if (song) {
      if (!isSongVisible(song)) {
        cell.classed("empty", true).style("background-color", "");
        return;
      }
      cell.style("background-color", taxonomy[song.genretaxonomy]?.color || "#2c292b");
    }
    // Tooltip 
    cell.on("mouseenter", function (event) {
      if (!song) return;
      let combinedTitle = song.tracks[0].title;
      if (song.tracks.length > 1 && song.tracks[1].title) combinedTitle += " / " + song.tracks[1].title;
      tooltip.classed("visible", true).html(`
        <h2>${combinedTitle}</h2>
        <p>${song.artists.join(" • ")}</p>
        <p>Rank ${song.rank} for ${song.chartYear}</p>
        <p>${song.primarygenre}</p>
      `).style("left", (event.pageX + 10) + "px").style("top", (event.pageY + 10) + "px");
    })
    .on("mouseleave", () => tooltip.classed("visible", false))
    .on("click", () => {
      if (!song) return;
      let songIndex = currentSongList.indexOf(song);
      if (songIndex === -1) songIndex = currentSongList.findIndex(s => s.chartYear === song.chartYear && s.rank === song.rank);
      if (songIndex !== -1) showSongModal(songIndex);
    });
  }

  function getVisibleSongs() {
    return currentSongList.filter(isSongVisible);
  }

  function openSidePanel() {
    d3.select("#side-panel").classed("open", true);
    
  }
  function closeSidePanel() {
    d3.select("#side-panel").classed("open", false);
  }
  ////////pushing the table ////

function openSidePanel() {
  const sidePanel = d3.select("#side-panel");
  sidePanel.classed("open", true);

  const chartWrapper = d3.select(".chart-wrapper");
  const sidePanelWidth = document.querySelector("#side-panel").offsetWidth;

  // Shift slightly and scale down just a bit
  const translateAmount = sidePanelWidth / 5;
  const scaleAmount = 0.87; 

  chartWrapper
    .style("transition", "transform 0.3s ease")
    .style("transform", `translateX(-${translateAmount}px) scale(${scaleAmount})`);
}

  function closeSidePanel() {
    const sidePanel = d3.select("#side-panel");
    sidePanel.classed("open", false);
    d3.select(".chart-wrapper").style("transition", "transform 0.3s ease")
      .style("transform", "translateX(0) scale(1)");
}

  function rerenderCurrentPanel(resetScroll = false) {
    if (!currentPanel.type) return;
    if (currentPanel.type === "taxonomy") showTaxonomyPanel(currentPanel.key, resetScroll);
    else if (currentPanel.type === "genre") showGenrePanel(currentPanel.key, resetScroll);
}


let firstOpen = true;

d3.select("#open-side-panel").on("click", () => {
  if (firstOpen) {
    firstOpen = false;
    renderHelpPanel(); 
  } else {
    openSidePanel(); 
  }
});

  // --- Side panel tabs ---
d3.selectAll(".panel-tab").on("click", function() {
  const tab = d3.select(this).attr("data-tab");
  d3.selectAll(".panel-tab").classed("active", false);
  d3.select(this).classed("active", true);

  if (tab === "genres") {
    if (currentPanel.type === "genre") showGenrePanel(currentPanel.key, false);
    else if (currentPanel.type === "taxonomy") showTaxonomyPanel(currentPanel.key, false);
    else {
  const defaultGenre = "Pop Rock";
  currentPanel = { type: "genre", key: defaultGenre };
  showGenrePanel(defaultGenre, true);
}
  } 
  else if (tab === "countries") renderCountriesPanel();
  else if (tab === "artists") renderArtistsPanel();
  else if (tab === "help") renderHelpPanel();
});

function getToggleAllLabelFor(obj) {
  const allChecked = Object.values(obj).every(v => v);
  return allChecked ? "Hide all" : "Show all";
}

function getSortButtonLabelFor(mode) {
  if (mode === "az") return `Sort A-Z <span class="icon">&#x25BC;</span>`;  
  if (mode === "za") return `Sort A-Z <span class="icon">&#x25B2;</span>`;  
  if (mode === "popular") return `Sort Popularity <span class="icon">&#x25BC;</span>`;
  if (mode === "unpopular") return `Sort Popularity <span class="icon">&#x25B2;</span>`;
  return `[Sort]`;
}


   // --- Countries panel ---
  function renderCountriesPanel() {
  const countryCounts = {};
  songs.forEach(s => (s.countryCode || []).forEach(c => { countryCounts[c] = (countryCounts[c] || 0) + 1; }));

  // Sort based on countrySortMode
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

  d3.select("#side-panel-body").html(`
    <h2>Countries</h2>
    <br>
    <p>
      <button id="toggle-all-countries">${getToggleAllLabelFor(countryVisibility)}</button>
      <button id="sort-countries-btn">${getSortButtonLabelFor(countrySortMode)}</button>
    </p>
    <br>
    <ul>
      ${sorted.map(([c,count]) => `
        <li>
          <input type="checkbox" class="country-toggle" data-country="${c}" ${countryVisibility[c] ? "checked" : ""}>
          <span>${c}</span> <span class="genre-count">[${count}]</span>
        </li>`).join("")}
    </ul>
  `);

  d3.selectAll(".country-toggle").on("change", function() {
    const c = d3.select(this).attr("data-country");
    countryVisibility[c] = this.checked;
    buildTable();
  });

  // Toggle all countries
d3.select("#toggle-all-countries").on("click", () => {
  const allChecked = Object.values(countryVisibility).every(v => v);
  const newState = !allChecked;
  Object.keys(countryVisibility).forEach(k => countryVisibility[k] = newState);
  d3.selectAll(".country-toggle").property("checked", newState);
  d3.select("#toggle-all-countries").text(getToggleAllLabelFor(countryVisibility));
  buildTable();
});

  // Sort countries
  d3.select("#sort-countries-btn").on("click", () => {
    if (countrySortMode === "az") countrySortMode = "za";
    else if (countrySortMode === "za") countrySortMode = "popular";
    else if (countrySortMode === "popular") countrySortMode = "unpopular";
    else countrySortMode = "az";
    renderCountriesPanel();
  });

  openSidePanel();
}
// --- Artists panel ---

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

  d3.select("#side-panel-body").html(`
    <h2>Artists</h2>
    <br>
    <p>
      <button id="toggle-all-artists">${getToggleAllLabelFor(artistVisibility)}</button>
      <button id="sort-artists-btn">${getSortButtonLabelFor(artistSortMode)}</button>
    </p>
    <br>
    <ul>
      ${sorted.map(([a,count]) => `
        <li>
          <input type="checkbox" class="artist-toggle" data-artist="${a}" ${artistVisibility[a] ? "checked" : ""}>
          <span>${a}</span> <span class="genre-count">[${count}]</span>
        </li>`).join("")}
    </ul>
  `);

  d3.selectAll(".artist-toggle").on("change", function() {
    const a = d3.select(this).attr("data-artist");
    artistVisibility[a] = this.checked;
    buildTable();
  });

// Toggle all Artists

d3.select("#toggle-all-artists").on("click", () => {
  const allChecked = Object.values(artistVisibility).every(v => v);
  const newState = !allChecked;
  Object.keys(artistVisibility).forEach(k => artistVisibility[k] = newState);
  d3.selectAll(".artist-toggle").property("checked", newState);
  d3.select("#toggle-all-artists").text(getToggleAllLabelFor(artistVisibility));
  buildTable();
});

// Artists Sort

  d3.select("#sort-artists-btn").on("click", () => {
    if (artistSortMode === "az") artistSortMode = "za";
    else if (artistSortMode === "za") artistSortMode = "popular";
    else if (artistSortMode === "popular") artistSortMode = "unpopular";
    else artistSortMode = "az";
    renderArtistsPanel();
  });

  openSidePanel();
}

// --- Help panel ---

function renderHelpPanel() {
  d3.selectAll(".panel-tab").classed("active", false);
  d3.select('.panel-tab[data-tab="help"]').classed("active", true);

const taxonomyBadgesHTML = Object.entries(taxonomy)
  .map(([key, info]) => `
    <div class="taxonomy-item" style="margin-top: 8px;">
      <span class="genre-badge clickable-taxonomy"
            data-taxonomy="${key}"
            style="border-color: ${info.color}">
        ${info.label}
      </span>
    </div>
  `).join("");

  d3.select("#side-panel-body").html(`
      <h2>About This Project</h2>
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
      <p>Designed and built by Levi. </p>
  `);
  bindGenreClicks();
  openSidePanel();
}


  // Song modal
  function showSongModal(songIndex) {
    const song = currentSongList[songIndex];
    if (!song) return;
    // Build combined title (A-side / B-side if present)
    let combinedTitle = song.tracks[0].title;
    if (song.tracks.length > 1 && song.tracks[1].title) {
      combinedTitle += " / " + song.tracks[1].title;
    }
    // Track switching (A/B sides)
    const hasSecondTrack = song.tracks.length > 1 && song.tracks[1].youtubeId;
    const hasSecondTitle = hasSecondTrack && !!song.tracks[1].title;

    let currentSide = "A";
    let currentTrack = song.tracks[0];
    // Helper to embed YouTube video. nocookie version
    const videoHtml = (track) => `
      <div class="video-wrapper">
        <iframe
          src="https://www.youtube-nocookie.com/embed/${track.youtubeId}"
          frameborder="0"
          allowfullscreen>
        </iframe>
      </div>
    `;
    // Build clickable genre spans
    const genreSpans = [song.primarygenre, ...(song.subgenres || [])]
      .map(g => `<span class="clickable-genre" data-genre="${g}">${g}</span>`)
      .join(" • ");
    // Peak chart info
    let peakInfo = "";
    if (song.peakPos) {
      peakInfo = `Peaked at #${song.peakPos}`;
      if (song.weeksOnChart) {
        peakInfo += ` for ${song.weeksOnChart} week${song.weeksOnChart > 1 ? "s" : ""}`;
      }
    }
    // Toggle button for A/B side
    let toggleButtonHtml = "";
    if (hasSecondTrack) {
      const initialLabel = hasSecondTitle ? "Show B-side" : "View other charting version";
      toggleButtonHtml = `<button class="track-toggle" id="toggle-side">${initialLabel}</button>`;
    }

    const tax = taxonomy[song.genretaxonomy];
    // Fill modal content
    d3.select("#modal-content").html(`
      <div id="video-container">${videoHtml(currentTrack)}</div>
      <h1 style="display:inline; font-weight: 700; margin-right: 8px;">
        ${combinedTitle}
      </h1>
      <h2 style="display:inline; font-weight: 600; font-size: 1.2rem;">
        (${song.releaseYear})
      </h2>
      <br>
      <p>
        <span class="artists">${song.artists.join(" • ")}</span>
        <span class="country" style="margin-left:8px;">(${song.countryCode.join(" • ")})</span>
      </p>
      <br>
      <p>Rank #${song.rank} for ${song.chartYear}  •  ${peakInfo ? `${peakInfo}` : ""}</p>
      <br>
              <p>${tax ? `<div class="genre-badge clickable-taxonomy" 
        style="border:2px solid ${tax.color}" 
        data-taxonomy="${song.genretaxonomy}">
        ${tax.label}
        </div>` : ""}</p> 

        <br>
      <p> 
      
      ${genreSpans} 
      
      </p>
        <br>
      
      <div class="modal-controls">
<button id="prev-song"><span class="icon">&#x25C0;</span><span class="label">Prev</span></button>
        ${toggleButtonHtml}
<button id="next-song"><span class="label">Next</span><span class="icon">&#x25B6;</span></button>
      </div>
    `);

    // Bind taxonomy + genre clicks inside modal
    bindGenreClicks();

    d3.selectAll(".clickable-genre").on("click", function() {
      const gKey = d3.select(this).attr("data-genre");
      showGenrePanel(gKey, true);
    
    });

    // A/B side toggle
    if (hasSecondTrack) {
      d3.select("#toggle-side").on("click", function () {
        if (currentSide === "A") {
          currentSide = "B";
          currentTrack = song.tracks[1];
          d3.select("#video-container").html(videoHtml(currentTrack));
          d3.select(this).text(hasSecondTitle ? "Show A-side" : "View other charting version");
        } else {
          currentSide = "A";
          currentTrack = song.tracks[0];
          d3.select("#video-container").html(videoHtml(currentTrack));
          d3.select(this).text(hasSecondTitle ? "Show B-side" : "View other charting version");
        }
      });
    }

    // Prev/Next navigation (only among visible songs)
    const visibleSongs = getVisibleSongs();
    const visibleIndex = visibleSongs.indexOf(song);

    function showSongModalFromSong(nextSong) {
      const idx = currentSongList.indexOf(nextSong);
      if (idx !== -1) showSongModal(idx);
    }

    d3.select("#prev-song").on("click", () => {
      const prevIdx = (visibleIndex - 1 + visibleSongs.length) % visibleSongs.length;
      showSongModalFromSong(visibleSongs[prevIdx]);
    });
    d3.select("#next-song").on("click", () => {
      const nextIdx = (visibleIndex + 1) % visibleSongs.length;
      showSongModalFromSong(visibleSongs[nextIdx]);
    });

    d3.select("#modal").style("display", "block");
  }

  // Return correct label for the "Show/Hide All" button
  function getToggleAllLabel() {
    const allChecked = Object.values(genreVisibility).every(v => v);
    return allChecked ? "Hide all" : "Show all";
  }


///organised genre list

function renderFeaturedGenresList() {
  const grouped = {};

  // Build a map: genreGroup → list of genres
  Object.entries(genres).forEach(([gKey, g]) => {
    const groups = Array.isArray(g.genreGroup) ? g.genreGroup : [g.genreGroup];
    groups.forEach(group => {
      if (!group) return;
      if (!grouped[group]) grouped[group] = [];
      grouped[group].push([gKey, g]);
    });
  });

  const sortedGroups = Object.keys(grouped).sort((a, b) => a.localeCompare(b));

  // Build HTML for each group
  return sortedGroups.map(group => {
    const groupGenres = grouped[group]
      .sort((a, b) => a[1].label.localeCompare(b[1].label))
      .map(([gKey, g]) => {
        const count = genreCounts[gKey] || 0; // 🔹 show how many songs that genre has
        return `
          <li class="genre-item" style="display:flex; align-items:center; gap:6px; margin:4px 0;">
            <input type="checkbox" class="genre-toggle" data-genre="${gKey}" ${genreVisibility[gKey] !== false ? "checked" : ""}>
            <span class="clickable-genre" data-genre="${gKey}">
              ${g.label}
            </span>
            <span class="genre-count">[${count}]</span>
          </li>`;
      }).join("");

    return `
      <h2 style="margin-top:10px; margin-bottom:4px;">${group}</h2>
      <ul>${groupGenres}</ul>
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
      <span class="genre-count">[${count}]</span>
    </li>`;
  }).join("");
}

  function bindGenreClicks() {
    d3.selectAll(".clickable-genre").on("click", function() {
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

  const btn = d3.select("#toggle-all-genres");
  if (!btn.empty()) {
    btn.on("click", function() {
      const allChecked = Object.values(genreVisibility).every(v => v);
      const newState = !allChecked;

      // Toggle all genres
      Object.keys(genreVisibility).forEach(k => { genreVisibility[k] = newState; });

      // Also toggle taxonomy checkboxes to match
      Object.keys(taxonomyVisibility).forEach(t => {
        taxonomyVisibility[t] = newState;
      });

      // Update UI checkboxes in the panel
      d3.selectAll(".genre-toggle").property("checked", newState);
      d3.selectAll(".taxonomy-toggle").property("checked", newState);

      buildTable();
      rerenderCurrentPanel(false);
      
      
      
    });
  }


  
const sortBtn = d3.select("#sort-genres-btn");
if (!sortBtn.empty()) {
  sortBtn.on("click", function() {
    if (genreSortMode === "az") genreSortMode = "za";
    else if (genreSortMode === "za") genreSortMode = "popular";
    else if (genreSortMode === "popular") genreSortMode = "unpopular";
    else genreSortMode = "az";

    // Rerender panel (button label will come from getSortButtonLabel)
    rerenderCurrentPanel(true);
  });
}
}
// taxonomy side panel
function getSortButtonLabel() {
  if (genreSortMode === "az") return `Sort A-Z <span class="icon">&#x25BC;</span>`;  
  if (genreSortMode === "za") return `Sort A-Z <span class="icon">&#x25B2;</span>`;  
  if (genreSortMode === "popular") return `Sort Popularity <span class="icon">&#x25BC;</span>`;
  if (genreSortMode === "unpopular") return `Sort Popularity <span class="icon">&#x25B2;</span>`;
  return `[Sort]`;
}
function showTaxonomyPanel(taxKey, resetScroll = true) {
    currentPanel = { type: "taxonomy", key: taxKey };
    
    // Activate the Genres tab whenever a taxonomy badge is clicked
    d3.selectAll(".panel-tab").classed("active", false);
    d3.select(".panel-tab[data-tab='genres']").classed("active", true);

    const info = taxonomy[taxKey];
    if (!info) return;

    const relatedHtml = Array.isArray(info.related) && info.related.length
      ? info.related.map(r => {
          const g = genres[r];
          return `
            <li>
              <input type="checkbox" class="genre-toggle" data-genre="${r}" ${genreVisibility[r] !== false ? "checked" : ""}>
              <span class="clickable-genre" data-genre="${r}">${g ? g.label : r}</span>
            </li>
          `;
        }).join("")
      : "<li>None listed</li>";

    const toggleAllLabel = getToggleAllLabel();
    d3.select("#side-panel-body").html(`
         <div>
        <input type="checkbox" class="taxonomy-toggle" data-taxonomy="${taxKey}" ${taxonomyVisibility[taxKey] !== false ? "checked" : ""}>
        <span class="genre-badge clickable-taxonomy" data-taxonomy="${taxKey}" style="border: 2px solid ${info.color}">${info.label} </span>

      </div>
      <br>
      <p>${info.description || ""}</p>
      <br>
      <h2>Key Genres:</h2>
      <br>
      <ul>${relatedHtml}</ul>
      <br>
      <h2>
        <span id="genre-list-mode" style="margin-right:8px;" class="panel-tab active" data-tab-mode="all">All Genres</span>
      </h2>
      <br>
      <p>
        <button id="toggle-all-genres">${toggleAllLabel}</button>
        <button id="sort-genres-btn">${getSortButtonLabel()}</button>
      </p>
      <br>
      <ul id="genre-list">${renderAllGenresList()}</ul>
      <br>
      <h2>Organised Genres</h2>
      <br>
      <ul>${renderFeaturedGenresList()}</ul>
    `);

    openSidePanel();
    if (resetScroll) d3.select("#side-panel").node().scrollTop = 0;
    bindGenreClicks();
    d3.select("#genre-list-mode").on("click", function() {
      d3.selectAll("#genre-list-mode").classed("active", true);
      d3.select("#genre-list").html(renderAllGenresList());
    });
  }

  // genre side panel ////////

  function showGenrePanel(genreKey, resetScroll = true) {
    // resolve case sensitivity if needed/ consistency with them all and json
    let resolvedKey = genreKey;
    if (!genres[genreKey]) {
      const found = Object.keys(genres).find(k => k.toLowerCase() === String(genreKey).toLowerCase());
      if (found) resolvedKey = found;
    }
    currentPanel = { type: "genre", key: resolvedKey };

    d3.selectAll(".panel-tab").classed("active", false);
    d3.select(".panel-tab[data-tab='genres']").classed("active", true);

    const g = genres[resolvedKey];
    const toggleAllLabel = getToggleAllLabel();
    // if no detailed info is supplied for the genre
    if (!g) {
      d3.select("#side-panel-body").html(`
        <h2>
          <input type="checkbox" class="genre-toggle" data-genre="${resolvedKey}" ${genreVisibility[resolvedKey] !== false ? "checked" : ""}>
          ${resolvedKey} <span class="genre-count">[${genreCounts[resolvedKey] || 0}]</span>
        </h2>
        <br>
        <p>No info on this genre.</p>
        <br>
        <h2>All Genres</h2>
        <br>
        <p><button id="toggle-all-genres">${toggleAllLabel}</button> <button id="sort-genres-btn">${getSortButtonLabel()}</button></p>
        <br>
        <ul>${renderAllGenresList()}</ul>
        <br>
        <h2>Organised Genres</h2>
        <br>
        <ul>${renderFeaturedGenresList()}</ul>
      `);
      openSidePanel();
      if (resetScroll) d3.select("#side-panel").node().scrollTop = 0;
      bindGenreClicks();
      return;
    }

    // taxonomy badge and related genres list
    const taxInfo = taxonomy[g.taxonomy];
    const taxBadge = taxInfo
      ? `<span class="genre-badge clickable-taxonomy" style="border:2px solid ${taxInfo.color}" data-taxonomy="${g.taxonomy}">${taxInfo.label}</span>`
      : `<span class="genre-badge clickable-taxonomy" data-taxonomy="${g.taxonomy}">${g.taxonomy}</span>`;

    const relatedHtml = Array.isArray(g.related) && g.related.length
      ? g.related.map(r => `
          <li>
            <input type="checkbox" class="genre-toggle" data-genre="${r}" ${genreVisibility[r] !== false ? "checked" : ""}>
            <span class="clickable-genre" data-genre="${r}">${genres[r]?.label || r}</span>
          </li>
        `).join("")
      : "<li>None listed</li>";
        //featured genres
    // Fill side panel body with genre info, taxonomy badge, related genres, and lists
    d3.select("#side-panel-body").html(`
      <h2>
        <input type="checkbox" class="genre-toggle" data-genre="${resolvedKey}" ${genreVisibility[resolvedKey] !== false ? "checked" : ""}>
        ${g.label} <span class="genre-count">[${genreCounts[resolvedKey] || 0}]</span>
      </h2>
      <br>
      <div>${taxBadge}</div>
      <br>
      <p>${g.description || ""}</p>
      <br>
      ${g.link ? `<p><a href="${g.link}" target="_blank">Learn more</a></p>` : ""}
      <br>
      <h2>Related genres:</h2>
      <br>
      <ul>${relatedHtml}</ul>
      <br>
      <h2>All Genres</h2>
      <br>
            <p>
        <button id="toggle-all-genres">${toggleAllLabel}</button>
        <button id="sort-genres-btn">${getSortButtonLabel()}</button>
      </p>
      <br>
      <ul>${renderAllGenresList()}</ul>
      <br>
      <h2>Organised Genres</h2>
      <br>
      <ul>${renderFeaturedGenresList()}</ul>
    `);

    openSidePanel();
    if (resetScroll) d3.select("#side-panel").node().scrollTop = 0;
    bindGenreClicks();
  }



  
  });
