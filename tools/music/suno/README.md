# Suno の曲を、つなぎ目なしでループする BGM にする道具（v1.8）

曲のファイルそのものは、このリポジトリには入れない（`bgm_private/` に置く。`.gitignore` 済み）。

```bash
# 1) 曲を 44.1kHz・ステレオの生データにする（名前は lobby / battle）
ffmpeg -i ロビーの曲.mp3 -ar 44100 -ac 2 -f f32le lobby_src.f32
ffmpeg -i バトルの曲.mp3 -ar 44100 -ac 2 -f f32le battle_src.f32
# 2) テンポ・拍・小節の頭をしらべる（バトルは 130〜175BPM の中でさがす）
python3 analyze.py lobby_src.f32
python3 analyze.py battle_src.f32 130 175
# 3) ループのはじめ A とおわり B の候補（A と B の直前がにている小節の頭どうし）
python3 loop_search.py lobby 50 150
python3 loop_search.py battle 60 150
# 4) ファイルを作る（A・B は拍の番号）→ lobby_loop.f32 と lobby_loop.json
python3 make_loop.py lobby 11 235
python3 make_loop.py battle 15 339
# 5) m4a と mp3 にして bgm_private/ へ。loops.json に start・end（秒）と play: 0 を書く
ffmpeg -f f32le -ar 44100 -ac 2 -i lobby_loop.f32 -c:a aac -b:a 144k -movflags +faststart bgm_lobby.m4a
ffmpeg -f f32le -ar 44100 -ac 2 -i lobby_loop.f32 -c:a libmp3lame -b:a 160k bgm_lobby.mp3
```

- ファイルの形：［曲のはじめ〜B（B の直前1拍は、A の直前1拍へ重ねて切りかえ）］＋［A から0.5秒］。ゲームは0秒から鳴らし、B まで来たら A へもどる
- B の位置は、A の直前と音の立ち上がりがいちばん重なるように数ミリ秒ずらす（Suno の曲はテンポが少しゆれるので）
- AAC や MP3 のデコーダーで頭の無音がずれても、重ねた1拍のぶんまではつなぎ目がずれない
