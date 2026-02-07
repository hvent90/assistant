import { $ } from "bun"
import { tmpdir } from "os"
import { join } from "path"
import { unlinkSync } from "fs"

const MODEL = process.env.WHISPER_MODEL ?? "/opt/homebrew/share/whisper-cpp/ggml-large-v3-turbo.bin"

export async function transcribeVoice(url: string): Promise<string | null> {
  const id = Date.now()
  const ogg = join(tmpdir(), `voice-${id}.ogg`)
  const wav = join(tmpdir(), `voice-${id}.wav`)
  try {
    const res = await fetch(url)
    await Bun.write(ogg, await res.arrayBuffer())
    await $`/opt/homebrew/bin/ffmpeg -i ${ogg} -ar 16000 -ac 1 -c:a pcm_s16le ${wav} -y -loglevel error`.quiet()
    const text = await $`/opt/homebrew/bin/whisper-cli -m ${MODEL} -f ${wav} -np -nt 2>&1`.text()
    console.log("whisper output:", JSON.stringify(text.trim()))
    return text.trim() || null
  } catch (error: any) {
    console.error("Transcription error:", error?.message || error)
    return null
  } finally {
    try { unlinkSync(ogg) } catch {}
    try { unlinkSync(wav) } catch {}
  }
}
