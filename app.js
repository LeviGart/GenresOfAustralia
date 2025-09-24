d3.json("./songs.json").then(dataset => {
  const songs = dataset.songs;
  const taxonomy = dataset.taxonomy || {};
  const genres = dataset.genres || {};

  let currentSongList = [];
  let sortMode = "chart"; // default

  const years = Array.from(new Set(songs.map(d => d.chartYear))).sort((a, b) => a - b);
  const ranks = d3.range(1, 11);

  const taxonomyOrder = ["hiphop","dance","soulrnb","rock", "countryfolk","jazztraditionalpop"];

  // Build a set of all genres present in the dataset
const allGenresSet = new Set();
songs.forEach(s => {
  if (s.primarygenre) allGenresSet.add(s.primarygenre.toLowerCase());
  if (Array.isArray(s.subgenres)) {
    s.subgenres.forEach(g => allGenresSet.add(g.toLowerCase()));
  }
});
const allGenresList = Array.from(allGenresSet).sort();

  // ===== Tooltip =====
  const tooltip = d3.select("body")
    .append("div")
    .attr("id", "tooltip");

  // ===== Legend (taxonomy badges) =====
  const legend = d3.select(".legend");
  Object.entries(taxonomy).forEach(([key, info]) => {
    legend.append("span")
      .attr("class", "genre-badge")
      .style("background-color", info.color)
      .text(info.label)
      .on("click", () => showTaxonomyPanel(key))
      .append("title")
      .text(info.description || "");
  });

  // ===== Sort controls (radio in HTML) =====
  d3.selectAll("input[name=sortMode]").on("change", function() {
    sortMode = this.value;
    buildTable();
  });

  // ===== Side panel close =====
  d3.select("#side-panel-close").on("click", () => closeSidePanel());
  d3.select("#side-panel").on("click", function(event) {
    if (event.target.id === "side-panel") closeSidePanel();
  });

  // ===== Song Modal close =====
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

  // ===== Table =====
  const table = d3.select(".chart-container")
    .append("table")
    .attr("class", "chart-table");

  const tbody = table.append("tbody");

  buildTable();

  function buildTable() {
    tbody.html("");
    currentSongList = [];

    if (sortMode === "chart") {
      // Original: rows = ranks 1..10
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
      // Sort by genre taxonomy within each year
      const songsByYear = {};
      years.forEach(year => {
        songsByYear[year] = songs
          .filter(d => d.chartYear === year)
          .sort((a, b) => {
            const ai = taxonomyOrder.indexOf(a.genretaxonomy);
            const bi = taxonomyOrder.indexOf(b.genretaxonomy);
            // If taxonomy not found, push to bottom (after known ones)
            return (ai === -1 ? taxonomyOrder.length : ai) - (bi === -1 ? taxonomyOrder.length : bi);
          });
      });

      const maxRows = d3.max(Object.values(songsByYear), arr => arr.length) || 0;

      for (let rowIndex = 0; rowIndex < maxRows; rowIndex++) {
        const tr = tbody.append("tr");
        years.forEach(year => {
          const song = songsByYear[year][rowIndex];
          appendCell(tr, song);
          if (song) currentSongList.push(song);
        });
      }
    }
  }

  function appendCell(row, song) {
    const cell = row.append("td")
      .attr("class", "chart-cell")
      .classed("empty", !song);

    if (song) {
      cell.style("background-color", taxonomy[song.genretaxonomy]?.color || "#333");
    }

    cell.on("mouseenter", function (event) {
        if (!song) return;
        let combinedTitle = song.tracks[0].title;
        if (song.tracks.length > 1 && song.tracks[1].title) {
          combinedTitle += " / " + song.tracks[1].title;
        }
        tooltip
          .classed("visible", true)
          .html(`
            ${combinedTitle}<br>
            ${song.artists.join(", ")}<br><br>
            Rank #${song.rank} for ${song.chartYear}<br><br>
            ${song.primarygenre}<br>
          `)
          .style("left", (event.pageX + 10) + "px")
          .style("top", (event.pageY + 10) + "px");
      })
      .on("mouseleave", () => tooltip.classed("visible", false))
      .on("click", () => {
        if (!song) return;
        // Prefer reference-based index to avoid mismatch after sorting
        let songIndex = currentSongList.indexOf(song);

        // Fallback: locate by identity keys if reference not found
        if (songIndex === -1) {
          songIndex = currentSongList.findIndex(s =>
            s.chartYear === song.chartYear && s.rank === song.rank
          );
        }

        if (songIndex !== -1) {
          showSongModal(songIndex);
        }
      });
  }

  // ===== Song Modal =====
  function showSongModal(songIndex) {
    const song = currentSongList[songIndex];
    if (!song) return;

    let combinedTitle = song.tracks[0].title;
    if (song.tracks.length > 1 && song.tracks[1].title) {
      combinedTitle += " / " + song.tracks[1].title;
    }

    const hasSecondTrack = song.tracks.length > 1 && song.tracks[1].youtubeId;
    const hasSecondTitle = hasSecondTrack && !!song.tracks[1].title;

    let currentSide = "A";
    let currentTrack = song.tracks[0];

    const videoHtml = (track) => `
      <div class="video-wrapper">
        <iframe
          src="https://www.youtube-nocookie.com/embed/${track.youtubeId}"
          frameborder="0"
          allowfullscreen>
        </iframe>
      </div>
    `;

    const combinedGenres = song.primarygenre +
      (song.subgenres && song.subgenres.length ? ", " + song.subgenres.join(", ") : "");

    let peakInfo = "";
    if (song.peakPos) {
      peakInfo = `Peaked at #${song.peakPos}`;
      if (song.weeksOnChart) {
        peakInfo += ` for ${song.weeksOnChart} week${song.weeksOnChart > 1 ? "s" : ""}`;
      }
    }

    let toggleButtonHtml = "";
    if (hasSecondTrack) {
      const initialLabel = hasSecondTitle ? "Show B-side" : "View other charting version";
      toggleButtonHtml = `<button class="track-toggle" id="toggle-side">${initialLabel}</button>`;
    }

    const tax = taxonomy[song.genretaxonomy];

    d3.select("#modal-content").html(`
      <h2>${combinedTitle}</h2>
      ${song.artists.join(", ")} <br>
      ${song.countryCode.join(", ")}<br><br>
      Released in ${song.releaseYear}<br>
      <p>#${song.rank} Year End Position For ${song.chartYear}</p>
      ${peakInfo ? `<p>${peakInfo}</p>` : ""}<br>
      ${tax ? `<div class="genre-badge" style="background-color:${tax.color}">${tax.label}</div>` : ""}
      <p>${combinedGenres}</p>
      <div id="video-container">${videoHtml(currentTrack)}</div>
      <div class="modal-controls">
        <button id="prev-song">&#8592; Prev</button>
        ${toggleButtonHtml}
        <button id="next-song">Next &#8594;</button>
      </div>
    `);

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

    d3.select("#prev-song").on("click", () => {
      showSongModal((songIndex - 1 + currentSongList.length) % currentSongList.length);
    });
    d3.select("#next-song").on("click", () => {
      showSongModal((songIndex + 1) % currentSongList.length);
    });

    d3.select("#modal").style("display", "block");
  }

  // ===== Side Panel helpers =====
  function openSidePanel() {
    d3.select("#side-panel").classed("open", true);
  }
  function closeSidePanel() {
    d3.select("#side-panel").classed("open", false);
  }

  function renderAllGenresList() {
    return Object.entries(genres)
      .map(([gKey, g]) => `<li class="clickable-genre" data-genre="${gKey}">${g.label}</li>`)
      .join("");
  }

  function bindGenreClicks() {
    d3.selectAll(".clickable-genre").on("click", function() {
      const genreKey = d3.select(this).attr("data-genre");
      showGenrePanel(genreKey);
    });
  }
function renderFeaturedGenresList() {
  return Object.entries(genres)
    .filter(([key, g]) => g.description && g.description.trim() !== "")
    .map(([gKey, g]) => `<li class="clickable-genre" data-genre="${gKey}">${g.label}</li>`)
    .join("");
}

function renderAllGenresList() {
  return allGenresList
    .map(gKey => {
      // If this genre has a manual entry, use its label, else just show the raw string
      const g = genres[gKey];
      return `<li class="clickable-genre" data-genre="${gKey}">${g ? g.label : gKey}</li>`;
    })
    .join("");
}
  // ===== Side Panel: Taxonomy view =====
  function showTaxonomyPanel(taxKey) {
    const info = taxonomy[taxKey];
    if (!info) return;

    const relatedHtml = Array.isArray(info.related) && info.related.length
      ? info.related.map(r => {
          const g = genres[r];
          return `<span class="clickable-genre" data-genre="${r}">${g ? g.label : r}</span>`;
        }).join(", ")
      : "None listed";


// genre taxonomy side panel
    const featuredHtml = renderFeaturedGenresList();
    const allHtml = renderAllGenresList();

    d3.select("#side-panel-body").html(`
      <div class="genre-badge" style="background-color:${info.color}">${info.label}</div>
      <p>${info.description || ""}</p>
      <br>
      <p><strong>Related genres:</strong> ${relatedHtml}</p>
      <br>
      <h4>'''complete''' genres in dataset:</h4>
      <br>
      <ul>${featuredHtml}</ul>
      <br>
      <h4>Complete list</h4>
      <br>
      <ul>${allHtml}</ul>
    `);

    openSidePanel();
    bindGenreClicks();
  }

  // ===== Side Panel: Genre view =====
  function showGenrePanel(genreKey) {
    const g = genres[genreKey];
    if (!g) return;

    const taxInfo = taxonomy[g.taxonomy];
    const taxBadge = taxInfo
      ? `<span class="genre-badge" style="background-color:${taxInfo.color}" data-taxonomy="${g.taxonomy}">${taxInfo.label}</span>`
      : `<span class="genre-badge" data-taxonomy="${g.taxonomy}">${g.taxonomy}</span>`;

    const relatedHtml = Array.isArray(g.related) && g.related.length
      ? g.related.map(r => `<span class="clickable-genre" data-genre="${r}">${genres[r]?.label || r}</span>`).join(", ")
      : "None listed";

    const allGenresHtml = renderAllGenresList();

// individual genre side panel
    const featuredHtml = renderFeaturedGenresList();
    const allHtml = renderAllGenresList();

    d3.select("#side-panel-body").html(`
      <h2>${g.label}</h2>
      <br>
      <div>${taxBadge}</div>
      <p>${g.description || ""}</p>
      <br>
      <p><strong>Related genres:</strong> ${relatedHtml}</p>
      <br>
      <h4>'''complete''' genres in dataset:</h4>
      <br>
      <ul>${featuredHtml}</ul>
      <br>
      <h4>Complete list</h4>
      <br>
      <ul>${allHtml}</ul>
    `);

    openSidePanel();

    // Bind clicks: related genres and taxonomy badge
    bindGenreClicks();
    d3.select(".genre-badge[data-taxonomy]").on("click", function() {
      const tKey = d3.select(this).attr("data-taxonomy");
      showTaxonomyPanel(tKey);
    });
  }
});
