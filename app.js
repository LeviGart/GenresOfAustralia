d3.json("./songs.json").then(dataset => {
  const songs = dataset.songs;
  const taxonomy = dataset.taxonomy || {};
  const genres = dataset.genres || {};

  let currentSongList = [];
  let sortMode = "chart";
  let currentPanel = { type: null, key: null };
  let genreSortMode = "az"; // az, za, popular, unpopular

  const years = Array.from(new Set(songs.map(d => d.chartYear))).sort((a, b) => a - b);
  const ranks = d3.range(1, 11);
  const taxonomyOrder = ["hiphop","dance","soulrnb","rock","countryfolk","jazztraditionalpop"];

  // Genres of Australia logo




  // Collect all genres (primary + subgenres)
  const allGenresSet = new Set();
  songs.forEach(s => {
    if (s.primarygenre) allGenresSet.add(s.primarygenre);
    if (Array.isArray(s.subgenres)) s.subgenres.forEach(g => allGenresSet.add(g));
  });
  const allGenresList = Array.from(allGenresSet).sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase())
  );
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

  // Track taxonomy visibility state
  let taxonomyVisibility = {};
  Object.keys(taxonomy).forEach(t => { taxonomyVisibility[t] = true; });

  // Tooltip
  const tooltip = d3.select("body").append("div").attr("id", "tooltip");

  // Legend (Taxonomy labels)
const legend = d3.select(".legend");

Object.entries(taxonomy).forEach(([key, info]) => {
  legend.append("span")
    .attr("class", "genre-badge clickable-taxonomy")
    .style("background-color", "transparent")      // remove fill
    .style("border", `2px solid ${info.color}`)   // dynamic border color
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

  // If no taxonomies are explicitly checked, behave normally (just use genres)
  const anyTaxChecked = Object.values(taxonomyVisibility).some(v => v);
  if (!anyTaxChecked) {
    return songGenres.some(g => genreVisibility[g]);
  }

  // Otherwise, filter by taxonomy + genres
  const taxOk = taxonomyVisibility[song.genretaxonomy];

  // If all genres are off but a taxonomy is selected, force genres on
  const anyGenreChecked = Object.values(genreVisibility).some(v => v);
  if (!anyGenreChecked && taxOk) {
    return true;
  }

  // Normal case: taxonomy + genre both must match
  return taxOk && songGenres.some(g => genreVisibility[g]);
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
    // Tooltip + click handlers
    cell.on("mouseenter", function (event) {
      if (!song) return;
      let combinedTitle = song.tracks[0].title;
      if (song.tracks.length > 1 && song.tracks[1].title) {
        combinedTitle += " / " + song.tracks[1].title;
      }
      tooltip.classed("visible", true).html(`
        <h2>${combinedTitle}</h2>
        <p>${song.artists.join(" • ")}</p>
        <p>Rank ${song.rank} for ${song.chartYear} </p>
        <p>${song.primarygenre}</p>
      `)
      .style("left", (event.pageX + 10) + "px")
      .style("top", (event.pageY + 10) + "px");
    })
    .on("mouseleave", () => tooltip.classed("visible", false))
    .on("click", () => {
      if (!song) return;
      let songIndex = currentSongList.indexOf(song);
      if (songIndex === -1) {
        songIndex = currentSongList.findIndex(s =>
          s.chartYear === song.chartYear && s.rank === song.rank
        );
      }
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

  const chartWrapper = d3.select(".chart-wrapper");

  // Reset to normal position and scale
  chartWrapper
    .style("transition", "transform 0.3s ease")
    .style("transform", "translateX(0) scale(1)");
}
///////old
  //function openSidePanel() {
    //d3.select("#side-panel").classed("open", true);  }
  //function closeSidePanel() {
   // d3.select("#side-panel").classed("open", false);}

  function rerenderCurrentPanel(resetScroll = false) {
    if (!currentPanel.type) return;
    if (currentPanel.type === "taxonomy") {
      showTaxonomyPanel(currentPanel.key, resetScroll);
    } else if (currentPanel.type === "genre") {
      showGenrePanel(currentPanel.key, resetScroll);
    }
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
      <p>
        <span class="artists">${song.artists.join(" • ")}</span>
        <span class="country" style="margin-left:8px;">(${song.countryCode.join(" • ")})</span>
      </p>
      
      <p>Rank #${song.rank} for ${song.chartYear}  •  ${peakInfo ? `${peakInfo}` : ""}</p>
      <br>
      
        <p>${genreSpans} </p>
        <br>
        <p>${tax ? `<div class="genre-badge clickable-taxonomy" 
        style="background-color:transparent; border:2px solid ${tax.color}" 
        data-taxonomy="${song.genretaxonomy}">
        ${tax.label}
        </div>` : ""}</p> 
      
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

  function renderFeaturedGenresList() {
    return Object.entries(genres)
      .filter(([key, g]) => g.description && g.description.trim() !== "")
      .map(([gKey, g]) => `
        <li>
          <input type="checkbox" class="genre-toggle" data-genre="${gKey}" ${genreVisibility[gKey] !== false ? "checked" : ""}>
          <span class="clickable-genre" data-genre="${gKey}">${g.label}</span>
        </li>
      `).join("");
  }


  
function renderAllGenresList() {
  let sorted = [...allGenresList];

  if (genreSortMode === "az") {
    sorted.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  } else if (genreSortMode === "za") {
    sorted.sort((a, b) => b.toLowerCase().localeCompare(a.toLowerCase()));
  } else if (genreSortMode === "popular") {
    sorted.sort((a, b) => (genreCounts[b] || 0) - (genreCounts[a] || 0));
  } else if (genreSortMode === "unpopular") {
    sorted.sort((a, b) => (genreCounts[a] || 0) - (genreCounts[b] || 0));
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
        <span class="genre-badge clickable-taxonomy" style="background-color:transparent; border:2px solid ${info.color}" data-taxonomy="${taxKey}">${info.label}</span>

      </div>
      <p>${info.description || ""}</p>
      <h4>Related genres:</h4>
      <ul>${relatedHtml}</ul>
      <h4>All genres in dataset:</h4>
      <p><button id="toggle-all-genres">${toggleAllLabel}</button> <button id="sort-genres-btn">${getSortButtonLabel()}</button></p>
      <ul>${renderAllGenresList()}</ul>
      <h4>"""Completed Genres:"""</h4>
      <ul>${renderFeaturedGenresList()}</ul>
    `);

    openSidePanel();
    if (resetScroll) d3.select("#side-panel").node().scrollTop = 0;
    bindGenreClicks();
  }

  // genre side panel
  function showGenrePanel(genreKey, resetScroll = true) {
    // resolve case sensitivity if needed/ consistency with them all and json
    let resolvedKey = genreKey;
    if (!genres[genreKey]) {
      const found = Object.keys(genres).find(k => k.toLowerCase() === String(genreKey).toLowerCase());
      if (found) resolvedKey = found;
    }
    currentPanel = { type: "genre", key: resolvedKey };

    const g = genres[resolvedKey];
    const toggleAllLabel = getToggleAllLabel();
    // if no detailed info is supplied for the genre
    if (!g) {
      d3.select("#side-panel-body").html(`
        <h1>
          <input type="checkbox" class="genre-toggle" data-genre="${resolvedKey}" ${genreVisibility[resolvedKey] !== false ? "checked" : ""}>
          ${resolvedKey} <span class="genre-count">[${genreCounts[resolvedKey] || 0}]</span>
        </h1>
        <p>No info on this genre.</p>
        <br>
        <h2>All genres in dataset:</h2>
        <p><button id="toggle-all-genres">${toggleAllLabel}</button> <button id="sort-genres-btn">${getSortButtonLabel()}</button></p>
        <ul>${renderAllGenresList()}</ul>
        <h4>"""Completed Genres:"""</h4>
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
      ? `<span class="genre-badge clickable-taxonomy" style="background-color:transparent; border:2px solid ${taxInfo.color}" data-taxonomy="${g.taxonomy}">${taxInfo.label}</span>`
      : `<span class="genre-badge clickable-taxonomy" data-taxonomy="${g.taxonomy}">${g.taxonomy}</span>`;

    const relatedHtml = Array.isArray(g.related) && g.related.length
      ? g.related.map(r => `
          <li>
            <input type="checkbox" class="genre-toggle" data-genre="${r}" ${genreVisibility[r] !== false ? "checked" : ""}>
            <span class="clickable-genre" data-genre="${r}">${genres[r]?.label || r}</span>
          </li>
        `).join("")
      : "<li>None listed</li>";

    // Fill side panel body with genre info, taxonomy badge, related genres, and lists
    d3.select("#side-panel-body").html(`
      <h2>
        <input type="checkbox" class="genre-toggle" data-genre="${resolvedKey}" ${genreVisibility[resolvedKey] !== false ? "checked" : ""}>
        ${g.label} <span class="genre-count">[${genreCounts[resolvedKey] || 0}]</span>
      </h2>
      <div>${taxBadge}</div>
      <p>${g.description || ""}</p>
      <h4>Related genres:</h4>
      <ul>${relatedHtml}</ul>
      <h4>All genres in dataset:</h4>
      <p><button id="toggle-all-genres">${toggleAllLabel}</button><button id="sort-genres-btn">${getSortButtonLabel()}</button></p>
      <ul>${renderAllGenresList()}</ul>
      <h4>"""Completed Genres:"""</h4>
      <ul>${renderFeaturedGenresList()}</ul>
    `);

    openSidePanel();
    if (resetScroll) d3.select("#side-panel").node().scrollTop = 0;
    bindGenreClicks();
  }

});
