import { useCallback, useEffect, useState } from 'react'
import type { LibraryRecording, ProjectSummary } from '@shared/types'
import { formatBytes, formatTimecode } from '@shared/time'
import { useStore } from '../state/store'
import { Badge, Button, EmptyState, IconButton, Modal, Segmented, Spinner, TextInput } from '../components/ui'
import { Icon } from '../components/Icon'

type Tab = 'projects' | 'recordings'

export function LibraryPage(): JSX.Element {
  const pushToast = useStore((state) => state.pushToast)
  const openProject = useStore((state) => state.openProject)
  const setView = useStore((state) => state.setView)
  const [tab, setTab] = useState<Tab>('projects')
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [recordings, setRecordings] = useState<LibraryRecording[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [recoveries, setRecoveries] = useState<Awaited<ReturnType<typeof window.api.projects.recoveryList>>>([])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [nextProjects, nextRecordings, nextRecoveries] = await Promise.all([
        window.api.projects.list(),
        window.api.library.recordings(),
        window.api.projects.recoveryList()
      ])
      setProjects(nextProjects)
      setRecordings(nextRecordings)
      setRecoveries(nextRecoveries)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const loadProject = async (id: string): Promise<void> => {
    setBusy(id)
    try {
      const project = await window.api.projects.load(id)
      if (!project) throw new Error('Project file is missing')
      openProject(project)
    } catch (error) {
      pushToast('error', 'Could not open the project', (error as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const createProject = async (): Promise<void> => {
    const name = newName.trim() || `Untitled ${new Date().toLocaleDateString()}`
    try {
      const project = await window.api.projects.create(name)
      setCreateOpen(false)
      setNewName('')
      openProject(project)
    } catch (error) {
      pushToast('error', 'Could not create the project', (error as Error).message)
    }
  }

  const projectFromRecording = async (recording: LibraryRecording): Promise<void> => {
    setBusy(recording.path)
    try {
      const project = await window.api.projects.create(recording.name.replace(/\.[^.]+$/, ''), recording.width || 1920, recording.height || 1080, recording.fps || 60)
      const updated = {
        ...project,
        clips: [
          {
            id: `clip_${Date.now().toString(36)}`,
            trackId: 'track-video-1',
            kind: 'video' as const,
            name: recording.name,
            sourcePath: recording.path,
            start: 0,
            duration: recording.durationMs / 1000 || 5,
            inPoint: 0,
            speed: 1,
            volume: 1,
            fadeIn: 0,
            fadeOut: 0,
            muted: false,
            crop: null,
            transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
            text: null,
            zoom: null,
            transitionIn: null,
            sourceWidth: recording.width || null,
            sourceHeight: recording.height || null,
            sourceDuration: recording.durationMs / 1000 || null,
            hasAudio: true,
            originStart: 0
          }
        ]
      }
      const saved = await window.api.projects.save(updated)
      openProject(saved)
    } catch (error) {
      pushToast('error', 'Could not build a project', (error as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-3">
        <div>
          <h1 className="text-[1.02rem] font-semibold tracking-tight">Library</h1>
          <p className="mt-0.5 text-[0.74rem] text-[var(--text-2)]">Projects, raw recordings and crash recovery snapshots</p>
        </div>
        <div className="flex items-center gap-2">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'projects', label: `Projects (${projects.length})`, icon: 'film' },
              { value: 'recordings', label: `Recordings (${recordings.length})`, icon: 'folder' }
            ]}
          />
          <Button size="sm" icon="plus" variant="primary" onClick={() => setCreateOpen(true)}>
            New project
          </Button>
          <IconButton icon="refresh" title="Refresh library" onClick={() => void refresh()} />
        </div>
      </div>

      {recoveries.length ? (
        <div className="border-b border-[var(--line)] bg-amber-400/[0.06] px-5 py-2">
          <div className="flex items-center gap-2 text-[0.74rem] text-amber-200">
            <Icon name="alert" size={13} />
            {recoveries.length} autosaved snapshot{recoveries.length > 1 ? 's' : ''} available
          </div>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {recoveries.slice(0, 4).map((snapshot) => (
              <button
                key={snapshot.path}
                type="button"
                onClick={() => {
                  void window.api.projects.restoreRecovery(snapshot.path).then((project) => {
                    if (project) {
                      pushToast('success', 'Snapshot restored', project.name)
                      openProject(project)
                      setRecoveries((current) => current.filter((entry) => entry.path !== snapshot.path))
                    }
                  })
                }}
                className="chip hover:border-sky-400/40 hover:text-sky-200"
              >
                {snapshot.projectName} · {new Date(snapshot.savedAt).toLocaleTimeString()} · {snapshot.clips} clips
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className={`scroll-area min-h-0 flex-1 px-5 py-4 ${loading ? 'opacity-60' : ''}`}>
        {tab === 'projects' ? (
          projects.length === 0 ? (
            <EmptyState
              icon="film"
              title="No projects yet"
              description="Record something, then open it in the editor, or start a blank project and drop media on the timeline."
              action={
                <div className="flex gap-2">
                  <Button variant="primary" icon="record" onClick={() => setView('record')}>
                    Record now
                  </Button>
                  <Button icon="plus" onClick={() => setCreateOpen(true)}>
                    Blank project
                  </Button>
                </div>
              }
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {projects.map((project) => (
                <div key={project.id} className="group overflow-hidden rounded-2xl border border-[var(--line)] bg-[rgba(10,15,22,0.7)] transition hover:border-sky-400/30 hover:shadow-[0_20px_50px_-30px_rgba(34,188,255,0.5)]">
                  <button type="button" onClick={() => void loadProject(project.id)} className="block w-full text-left">
                    <div className="relative aspect-video w-full overflow-hidden bg-black/60">
                      {project.thumbnail ? (
                        <img src={window.api.app.mediaUrl(project.thumbnail)} alt={project.name} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-[var(--text-2)]">
                          <Icon name="film" size={26} />
                        </div>
                      )}
                      <div className="absolute bottom-2 right-2 rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-[0.62rem] text-white/80">
                        {formatTimecode(project.duration)}
                      </div>
                      {busy === project.id ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                          <Spinner />
                        </div>
                      ) : null}
                    </div>
                  </button>
                  <div className="flex items-start justify-between gap-2 px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-[0.8rem] font-medium text-[var(--text-0)]">{project.name}</div>
                      <div className="mt-0.5 text-[0.66rem] text-[var(--text-2)]">
                        {project.width}×{project.height} · {project.fps} fps · {project.clipCount} clips
                      </div>
                      <div className="text-[0.62rem] text-[var(--text-2)]">Edited {new Date(project.updatedAt).toLocaleString()}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <IconButton icon="play" title="Play the source recording" onClick={() => project.sourcePath && void window.api.library.openFile(project.sourcePath)} />
                      <IconButton
                        icon="trash"
                        title="Delete project"
                        tone="danger"
                        onClick={() => {
                          void window.api.projects.delete(project.id).then(() => {
                            setProjects((current) => current.filter((entry) => entry.id !== project.id))
                            pushToast('info', 'Project deleted', project.name)
                          })
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : recordings.length === 0 ? (
          <EmptyState icon="folder" title="No recordings on disk" description="Your captures are stored in the SkyRec folder inside your Videos library. Record something to see it here." action={<Button variant="primary" icon="record" onClick={() => setView('record')}>Start recording</Button>} />
        ) : (
          <div className="flex flex-col gap-2">
            {recordings.map((recording) => (
              <div key={recording.path} className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[rgba(10,15,22,0.7)] p-2.5">
                <div className="h-14 w-24 shrink-0 overflow-hidden rounded-lg bg-black/50">
                  {recording.thumbnail ? (
                    <img src={window.api.app.mediaUrl(recording.thumbnail)} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-[var(--text-2)]">
                      <Icon name="film" size={18} />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[0.8rem] font-medium text-[var(--text-0)]">{recording.name}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[0.66rem] text-[var(--text-2)]">
                    <span>{formatTimecode(recording.durationMs / 1000)}</span>
                    <span>· {formatBytes(recording.sizeBytes)}</span>
                    <span>· {recording.width}×{recording.height}</span>
                    <span>· {new Date(recording.createdAt).toLocaleString()}</span>
                    {recording.projectId ? <Badge tone="accent">in project</Badge> : null}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button size="sm" icon="play" onClick={() => void window.api.library.openFile(recording.path)}>
                    Play
                  </Button>
                  <Button size="sm" icon="film" onClick={() => void projectFromRecording(recording)} disabled={busy === recording.path}>
                    Edit
                  </Button>
                  <IconButton
                    icon="trash"
                    title="Delete recording"
                    tone="danger"
                    onClick={() => {
                      void window.api.library.deleteRecording(recording.path).then((next) => {
                        setRecordings(next)
                        pushToast('info', 'Recording deleted')
                      })
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New project"
        subtitle="Start from an empty 1080p60 timeline, or record first."
        footer={
          <>
            <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button variant="primary" icon="plus" onClick={() => void createProject()}>
              Create
            </Button>
          </>
        }
      >
        <TextInput value={newName} onChange={setNewName} placeholder="Project name" />
      </Modal>
    </div>
  )
}
