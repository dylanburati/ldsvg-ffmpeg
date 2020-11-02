## ldsvg-ffmpeg
Convert a line delimited svg file to a video using ffmpeg

```bash
# Usage: ldsvg-ffmpeg [-o <output>] [-r <frame rate>] <input>
#   output defaults to "video.mp4"
#   frame rate defaults to 60

# input can be a file
$ ldsvg-ffmpeg -o myvideo.avi svg_series.txt

# or use stdin
$ cat svg_series*.txt | ldsvg-ffmpeg -o myvideo.avi -
```

### Installation

```bash
$ npm install -g git://github.com/dylanburati/ldsvg-ffmpeg
```
