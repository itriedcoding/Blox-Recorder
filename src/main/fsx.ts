import { promises as fs } from 'node:fs'
import path from 'node:path'

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
}

export async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

export async function readJson<T>(file: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(file, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(file))
  const temp = `${file}.tmp`
  await fs.writeFile(temp, JSON.stringify(value, null, 2), 'utf8')
  await fs.rename(temp, file)
}

export async function writeText(file: string, value: string): Promise<void> {
  await ensureDir(path.dirname(file))
  await fs.writeFile(file, value, 'utf8')
}

export async function writeBinary(file: string, data: Uint8Array): Promise<void> {
  await ensureDir(path.dirname(file))
  await fs.writeFile(file, data)
}

export async function readText(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8')
  } catch {
    return null
  }
}

export async function appendFile(file: string, data: string | Uint8Array): Promise<void> {
  await ensureDir(path.dirname(file))
  await fs.appendFile(file, data)
}

export async function remove(target: string): Promise<void> {
  await fs.rm(target, { recursive: true, force: true })
}

export async function copyFile(source: string, destination: string): Promise<void> {
  await ensureDir(path.dirname(destination))
  await fs.copyFile(source, destination)
}

export async function statfs(target: string): Promise<{ free: number } | null> {
  try {
    const info = await fs.statfs(target)
    return { free: info.bfree * info.bsize }
  } catch {
    return null
  }
}

export async function stat(target: string): Promise<{ size: number; mtimeMs: number } | null> {
  try {
    const info = await fs.stat(target)
    return { size: info.size, mtimeMs: info.mtimeMs }
  } catch {
    return null
  }
}

export async function readDir(target: string): Promise<{ name: string; isDirectory: boolean; size: number }[]> {
  try {
    const entries = await fs.readdir(target, { withFileTypes: true })
    const results: { name: string; isDirectory: boolean; size: number }[] = []
    for (const entry of entries) {
      let size = 0
      if (entry.isFile()) {
        try {
          size = (await fs.stat(path.join(target, entry.name))).size
        } catch {
          size = 0
        }
      }
      results.push({ name: entry.name, isDirectory: entry.isDirectory(), size })
    }
    return results
  } catch {
    return []
  }
}
