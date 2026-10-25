# Olti Myrtaj: research website

Five pages (About, Research, Gallery, Community, CV) in plain HTML and CSS. There is no
build step, so GitHub Pages serves the files exactly as they are.

## Put it online

1. Sign in to GitHub and create a new repository named exactly
   `USERNAME.github.io`, where `USERNAME` is your GitHub username. Make it Public.
2. On the repository page, choose **Add file → Upload files**. Drag in everything
   inside this folder (`index.html`, `research.html`, `gallery.html`,
   `community.html`, `cv.html`, `favicon.svg`, and the `css`, `js`, `images`, `files` and `tools` folders),
   then select **Commit changes**.
3. Open **Settings → Pages**. Under **Build and deployment**, set the source to
   **Deploy from a branch**, choose the `main` branch and the `/ (root)` folder,
   and save.
4. The site appears at `https://USERNAME.github.io`, usually within a few
   minutes (GitHub allows up to 10).

After that, any file you edit or upload on GitHub republishes the site
automatically.

## Add your pictures

Pictures live in `images/` under the names below. Until a file exists, its
frame on the site shows the file name it is waiting for, so you can see at a
glance what is still missing. Add them before you share the link.

| File | Page | What goes there |
| --- | --- | --- |
| `images/headshot.jpg` | About | Portrait headshot, 4:5, at least 800 × 1000 px (already added) |
| `images/three-phases.jpg` | About | The three-phase figure at the top of the homepage (already added) |
| `images/research/phase-protogalaxy.jpg` | Research | Romeo edge-on, 12.8 Gyr ago (2:1, rendered from the data export) |
| `images/research/phase-thick-disk.jpg` | Research | Romeo edge-on, 7.1 Gyr ago (2:1, rendered) |
| `images/research/phase-thin-disk.jpg` | Research | Romeo edge-on, today (2:1, rendered) |
| `images/research/gaia-vs-romeo.png` | Research | Figure 1 of the paper (already added, cropped from arXiv v1) |
| `images/research/appendix-g-romeo.mp4` (+ `.webm`, `appendix-g-poster.png`) | Research | Appendix G as a movie (already added) |
| `images/research/paper-fig*.png`, `paper-figD1-thelma-velocity.jpg` | Research | Figures 5, 6, 11 and D1 of the paper (already added, cropped from arXiv v1) |
| `images/research/tp-onset-conditions.png` | Research | Turning Point figure: circularity, sloshing, torques and binding for Romeo, Remus, Thelma and m12f (already added) |
| `images/research/tp-fig7-misalignment.png` | Research | Figure 7 of Turning Point (already added) |
| `images/research/dip-*.jpg`, `dip-mock-alma-jwst.png` | Research | The three Disks in Progress figures from the Hubble proposal (already added) |
| `images/research/chem-*.png` | Research | Romeo's orbits against [Fe/H], [Mg/Fe], [O/Fe] and [C/N], one figure each (rendered by `make_chemistry.py`) |
| `images/research/sloshing-thelma.mp4` (+ `.webm`, `-poster.jpg`) | Research | Movie of Thelma from the protogalaxy until today, with its sloshing parameter (rendered by `make_sloshing_movie.py`) |
| `images/gallery/twelve-galaxies.jpg` | Gallery | All twelve galaxies, face-on and edge-on, today (rendered) |
| `images/gallery/three-phases.jpg` | Gallery | Romeo face-on and edge-on in its three phases (rendered) |
| `images/gallery/gas-and-stars-spin-up.jpg` | Gallery | Romeo's stars and cold gas at the onset of gas rotation (rendered) |
| `images/gallery/romeo-and-juliet.jpg` | Gallery | The Romeo and Juliet pair (rendered) |
| `images/gallery/gas-face-on.jpg` | Gallery | Romeo's cold gas disk, face-on (rendered) |
| `images/gallery/hot-inner-halo.jpg` | Gallery | Gas temperature before and after cooldown (rendered) |
| `images/gallery/birth-phases.jpg` | Gallery | Romeo's stars split by birth phase (rendered) |
| `images/gallery/disk-formation.mp4` (+ `.webm`, `-poster.jpg`) | Gallery | Movie of Romeo forming its disk (rendered) |
| `images/gallery/galfresca-2026.jpg` | Community | GalFRESCA 2026 group photo (already added) |
| `images/gallery/galfresca-2024.jpg` | Community | With your research group at GalFRESCA 2024 (already added) |
| `images/gallery/masters-graduation.jpg` | Community | Master's graduation with James Bullock (already added) |
| `images/gallery/eas-2024.jpg` | Community | EAS 2024 in Padova (already added) |
| `images/gallery/usc-cosmolab.jpg` | Community | Your CosmoLab seminar at USC (already added) |
| `images/gallery/lick-shane.jpg` | Community | Observing with the Shane telescope at Lick (already added) |
| `images/gallery/aas-246.jpg` | Community | Your AAS 246 talk (already added) |
| `images/gallery/night-sky-festival.jpg` | Community | Night Sky Festival buttons (already added) |
| `images/gallery/discovery-cube.jpg` | Community | Discovery Cube Solar System exhibit team (already added) |
| `images/gallery/cosmos.jpg` | Community | With your COSMOS students (already added) |
| `images/outreach/*.jpg` | About, Community | The three Beyond-research photos (already added) |
| `images/outreach/surf-2026-*.jpg` | Community | The four SURF 2026 symposium photos in the collage (already added) |

To skip a picture, delete its `<figure class="slot"> … </figure>` block from
the page. To add another, copy a block and change the file name, the `alt`
text and the caption.

### Shrink big images first

Full-resolution renders are often 10–50 MB. Web versions around 2000 px load
fast and still look sharp.

```
pip install pillow
python tools/prepare_images.py ~/renders images/gallery                 # renders and photos, saved as JPEG
python tools/prepare_images.py figure1.png images/research --format png  # plots keep sharp text
```

Keep movies under 50 MB. GitHub refuses any single file over 100 MB.

### Re-render the simulation images

The simulation images, the chemistry figures and the two movies are rendered from the
eight `website_*.hdf5` files that `extract_website_data.py` writes on the cluster.
Put those files in a `website_data/` folder next to this README (it is listed
in `.gitignore`, so the data never goes to GitHub), then run:

```
pip install numpy scipy h5py pillow
python tools/render/make_images.py           # every still, or name some: research three twelve spinup halo pair gas phases
python tools/render/make_movie.py            # the movie, its WebM copy and its poster (needs ffmpeg)
python tools/render/make_sloshing_movie.py   # Thelma's sloshing movie (needs ffmpeg)
python tools/render/make_chemistry.py        # the four chemistry figures (needs matplotlib)
```

The colors are mock starlight: each stellar-age map is weighted by a rough
light-to-mass ratio, dimmed by dust mixed in with the stars, and shown with an
asinh stretch. The settings sit at the top of `tools/render/galrender.py`.

The after-cooldown panel of `hot-inner-halo.jpg` leaves out the extended cold gas
left of the disk and an infalling satellite at lower right. `tools/render/halo_fill.py`
keeps the main disk and its warm rim, and refills the rest with hot halo gas: the clean
halo's radial profile, smoothly interpolated across the gap, plus its own fine grain
copied from mirror-image positions at the same radius.

## CV PDF

Export the CV from Overleaf, name it `Myrtaj_CV.pdf`, and put it in `files/`.
The Download button on the CV page turns on once the file is there.

## Where to edit

| What | File |
| --- | --- |
| About text, the homepage figure caption and the "Latest" list | `index.html` |
| Research text | `research.html` |
| Gallery captions | `gallery.html` |
| Meetings, outreach and science writing | `community.html` |
| CV entries | `cv.html` |
| Email address | every `data-email-user` / `data-email-domain` pair (About page and each footer) |
| Colors and fonts | the top of `css/style.css` |
| The animated model on the Research page | `js/galaxy-gl.js` (WebGL). Phase timing is in `T_SPIN` and `T_COOL`, the mergers in `SAT_SPEC`, the filaments in `STREAMS`, the spiral pattern in `R_CR` and `ARM_GAS`, and the look in `DUST_K`, `IN_K`, `OUT_K` and `EXPOSURE_K`. `js/galaxy.js` is the simpler fallback for browsers without WebGL2. The "Heuristic example: not actual data" label is plain HTML in `research.html` |
| Science writing list | the "Science writing" section of `community.html` and the CV |

## Preview on your own computer

Double-click `index.html`. Everything works offline except the web fonts.

## Get found on Google

Google finds public sites on its own, but these steps get the site indexed in
days instead of weeks, and they let you watch how people find it.

1. Put the live address into the site: `python tools/set_site_url.py https://USERNAME.github.io`.
   This fills in the canonical links, the link-preview tags, `sitemap.xml` and `robots.txt`.
2. In [Google Search Console](https://search.google.com/search-console), add a
   **URL prefix** property for `https://USERNAME.github.io/`. Pick the **HTML tag**
   verification method, paste the tag into the `<head>` of `index.html`, upload, and
   select **Verify**.
3. Under **Sitemaps**, submit `sitemap.xml`.
4. Under **URL inspection**, enter the homepage address and select **Request indexing**.
5. Link the site from your other profiles: ORCID, Google Scholar, LinkedIn, GitHub,
   your UC Irvine department page and your email signature. Links from pages Google
   already trusts are what get a new site found and ranked.

The homepage also carries a short machine-readable profile (name, position,
affiliation, ORCID) that search engines read. Add any new profile pages to its
`sameAs` list in `index.html`.

## Optional: your own domain

Buy a domain (for example `oltimyrtaj.com`), then add it under
**Settings → Pages → Custom domain** and follow GitHub's DNS instructions.
