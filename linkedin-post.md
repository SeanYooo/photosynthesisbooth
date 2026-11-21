I built a browser photo booth that turns a 6-shot webcam burst into a printable strip. No framework, no backend — vanilla JS with getUserMedia and canvas compositing.

The interesting fix: the frame preview had its layer order wrong, with overlay art drawn under the photos instead of on top. I caught it by comparing the preview grid against the final export and fixed it in the thumbnail pipeline.

Live demo: https://seanyooo.github.io/photosynthesisbooth/
