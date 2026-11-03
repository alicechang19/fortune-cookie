# Fortune Cookie

A small three.js toy: a pile of wrapped fortune cookies rains onto the screen. Brush through them, pick one, tear the wrapper, hold to crack it open, and read your fortune.

## Run it

It's a single static page, but the model has to be loaded over HTTP:

```sh
python3 -m http.server 8931
```

Then open http://localhost:8931/.

## Files

- `index.html`: the whole app (three.js r170 from a CDN, no build step).
- `cookie.glb`: the cookie used in the app. It's decimated, hollowed and cracked into two halves, and includes light copies for the pile.
- `fortune cookie render.glb`: the original Tripo model.
- `build_cookie.py`: Blender script that turns the Tripo model into `cookie.glb`:
  ```sh
  blender -b --python build_cookie.py -- "fortune cookie render.glb" cookie.glb fortune_cookie.blend
  ```
- `fortune_cookie.blend`: the Tripo cookie and its game halves in Blender.
- `fortune_cookie.py`, `fortune_cookie_procedural.blend`: the earlier procedural Blender cookie.
