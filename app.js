// Load JSON file
d3.json("./songs.json").then(dataset => {
  
  const songs = dataset.songs;
  const taxonomy = dataset.taxonomy;

  // Extract all unique years from chartYear
  const years = Array.from(new Set(songs.map(d => d.chartYear))).sort((a, b) => a - b);
  const ranks = d3.range(1, 11); // 1–10

  // Tooltip setup
  const tooltip = d3.select("body")
    .append("div")
    .attr("id", "tooltip")
    .style("position", "absolute")
    .style("background", "rgba(0,0,0,0.85)")
    .style("color", "#fff")
    .style("padding", "6px 8px")
    .style("border-radius", "4px")
    .style("font-size", "0.8rem")
    .style("pointer-events", "none")
    .style("opacity", 0);

  // Create table
  const table = d3.select("div") // selects the <div> in your HTML
    .append("table")
    .style("border-collapse", "collapse")
    .style("margin", "auto");

  const tbody = table.append("tbody");

  // Loop through ranks (rows)
  ranks.forEach(rank => {
    const row = tbody.append("tr");

    years.forEach(year => {
      // Find the song for this year and rank
      const song = songs.find(d => d.chartYear === year && d.rank === rank);

    row.append("td")
    .style("width", "24px")
    .style("height", "48px")
    //.style("border", "0.1px solid rgba(0, 0, 0, 0.1)")
    .style("background-color", song ? taxonomy[song.genretaxonomy].color : "#333")
    .on("mouseenter", function (event) {
        if (!song) return;

        // Combined title for hover
        let combinedTitle = song.tracks[0].title;
        if (song.tracks.length > 1 && song.tracks[1].title) {
            combinedTitle += " / " + song.tracks[1].title;
        }

        tooltip
            .style("opacity", 1)
            .html(`
            ${combinedTitle}<br>
            ${song.artists.join(", ")}<br>
            Released: ${song.releaseYear}<br>
            Rank #${song.rank} for ${song.chartYear}<br>
            ${song.primarygenre}<br>
            `)
            .style("left", (event.pageX + 10) + "px")
            .style("top", (event.pageY + 10) + "px");
        })
        .on("mouseleave", () => tooltip.style("opacity", 0))
        .on("click", () => {
        if (!song) return;

        // Combined title for popup
        let combinedTitle = song.tracks[0].title;
        if (song.tracks.length > 1 && song.tracks[1].title) {
            combinedTitle += " / " + song.tracks[1].title;
        }

        const hasBside = song.tracks.length > 1 &&
                        song.tracks[1].title &&
                        song.tracks[1].youtubeId;

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

        let toggleButtonHtml = "";
        if (hasBside) {
            toggleButtonHtml = `<button class="track-toggle" id="toggle-side">Show B-side</button>`;
        }

        // Combined genre list
        const combinedGenres = song.primarygenre + 
            (song.subgenres && song.subgenres.length ? ", " + song.subgenres.join(", ") : "");

        // Inject content
        d3.select("#modal-content").html(`
            <h2>${combinedTitle}</h2>
            <p><strong>By:</strong> ${song.artists.join(", ")}</p>
            <p><strong>Released:</strong> ${song.releaseYear}</p>
            ${song.countryCode.join(", ")}
            <p>#${song.rank} for ${song.chartYear}</P>
            <div class="genre-badge" style="background-color:${taxonomy[song.genretaxonomy].color}">
            ${taxonomy[song.genretaxonomy].label}
            </div>
            ${combinedGenres}
            <div id="video-container">${videoHtml(currentTrack)}</div>
            ${toggleButtonHtml}
        `);


        d3.select("#modal-close").on("click", () => {
            d3.selectAll("#video-container iframe").attr("src", "");
            d3.select("#modal").style("display", "none");
        });

        // Toggle button logic
        if (hasBside) {
            d3.select("#toggle-side").on("click", function () {
            if (currentSide === "A") {
                currentSide = "B";
                currentTrack = song.tracks[1];
                d3.select("#video-container").html(videoHtml(currentTrack));
                d3.select(this).text("Show A-side");
            } else {
                currentSide = "A";
                currentTrack = song.tracks[0];
                d3.select("#video-container").html(videoHtml(currentTrack));
                d3.select(this).text("Show B-side");
            }
            });
        }

        d3.select("#modal").style("display", "block");
        });
    });
  });

  // Close modal when clicking the close button
  d3.select("#modal-close").on("click", () => {
    d3.select("#modal").style("display", "none");
  });


});

