import { useState } from 'react';
import type { ResumeBuilderData } from '@/types/resume.types';

interface Props {
  versions: ResumeBuilderData[];
  activeVersionId: string | null;
  onSwitch: (id: string) => void;
  onCreate: (name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
}

export default function VersionSelector({
  versions,
  activeVersionId,
  onSwitch,
  onCreate,
  onDelete,
  onRename,
}: Props) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [creatingNew, setCreatingNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const activeVersion = versions.find((v) => v.id === activeVersionId);

  const handleCreate = async () => {
    const name = newName.trim() || 'New Resume';
    setCreatingNew(false);
    setNewName('');
    await onCreate(name);
  };

  const handleRename = async (id: string) => {
    if (!editName.trim()) return;
    await onRename(id, editName.trim());
    setEditingId(null);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="flex items-center gap-1.5 h-8 px-3 text-sm border border-border rounded-md bg-background hover:bg-muted transition-colors max-w-[180px]"
        aria-label="Select resume version"
      >
        <span className="truncate">{activeVersion?.version_name ?? 'My Resume'}</span>
        <span className="text-muted-foreground">▾</span>
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

          <div className="absolute left-0 top-10 z-50 w-64 bg-popover border border-border rounded-lg shadow-xl overflow-hidden">
            <div className="p-1.5 max-h-56 overflow-y-auto">
              {versions.map((v) => (
                <div
                  key={v.id}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm cursor-pointer group ${
                    v.id === activeVersionId
                      ? 'bg-primary/10 text-primary'
                      : 'hover:bg-muted text-foreground'
                  }`}
                  onClick={() => {
                    if (editingId !== v.id) {
                      onSwitch(v.id);
                      setOpen(false);
                    }
                  }}
                >
                  {editingId === v.id ? (
                    <input
                      type="text"
                      className="flex-1 text-sm bg-background border border-border rounded px-1.5 py-0.5 outline-none"
                      value={editName}
                      autoFocus
                      aria-label="Rename version"
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename(v.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      onBlur={() => handleRename(v.id)}
                    />
                  ) : (
                    <span className="flex-1 truncate">{v.version_name}</span>
                  )}

                  {editingId !== v.id && (
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingId(v.id);
                          setEditName(v.version_name);
                        }}
                        className="text-[10px] text-muted-foreground hover:text-foreground"
                        aria-label="Rename"
                      >
                        ✏
                      </button>
                      {versions.length > 1 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete(v.id);
                          }}
                          className="text-[10px] text-muted-foreground hover:text-destructive"
                          aria-label="Delete version"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="border-t border-border p-1.5">
              {creatingNew ? (
                <div className="flex gap-1">
                  <input
                    type="text"
                    className="flex-1 h-7 text-sm bg-background border border-border rounded px-2 outline-none"
                    placeholder="Version name"
                    value={newName}
                    autoFocus
                    aria-label="New version name"
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreate();
                      if (e.key === 'Escape') setCreatingNew(false);
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleCreate}
                    className="text-xs px-2 bg-primary text-primary-foreground rounded"
                  >
                    Create
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setCreatingNew(true)}
                  className="w-full text-xs text-left px-2 py-1.5 text-muted-foreground hover:text-primary hover:bg-muted rounded-md transition-colors"
                >
                  + New version
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
