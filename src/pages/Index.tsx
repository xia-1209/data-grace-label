import { useEffect, useMemo, useState } from "react";
import { LIBRARIES, MOCK_IMAGES, UI_TEXT, type FieldDef, type LibraryDef } from "@/lib/annotation-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, Info, Plus, Save, Send, X, History } from "lucide-react";
import { toast } from "sonner";

type Lang = "zh" | "en";
type Perspective = "production" | "commercial";
type Audience = "tob" | "toc";

interface AnnotationState {
  values: Record<string, any>;
  customTags: string[];
  customOptions: Record<string, string[]>; // fieldKey -> extra options
}

const STORAGE_KEY = "garment-annot-v1";

function emptyState(): AnnotationState {
  return { values: {}, customTags: [], customOptions: {} };
}

function loadStore(): Record<string, AnnotationState> {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; }
}
function saveStore(store: Record<string, AnnotationState>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}
function makeKey(lib: string, image: string) { return `${lib}::${image}`; }

const Index = () => {
  const [libKey, setLibKey] = useState(LIBRARIES[0].key);
  const [imgIdx, setImgIdx] = useState(0);
  const [perspective, setPerspective] = useState<Perspective>("production");
  const [audience, setAudience] = useState<Audience>("tob");
  const [lang, setLang] = useState<Lang>("zh");
  const [store, setStore] = useState<Record<string, AnnotationState>>(loadStore);
  const [addDialog, setAddDialog] = useState<{ field: string; name: string } | null>(null);
  const [customTagDialog, setCustomTagDialog] = useState(false);
  const [newCustomTag, setNewCustomTag] = useState("");
  const [commentImageId, setCommentImageId] = useState("comment_001");
  const [historyOpen, setHistoryOpen] = useState(false);

  const t = UI_TEXT[lang];
  const lib = useMemo<LibraryDef>(() => LIBRARIES.find(l => l.key === libKey)!, [libKey]);
  const currentImageId = lib.hasImage ? MOCK_IMAGES[imgIdx].id : commentImageId;
  const stateKey = makeKey(libKey, currentImageId);
  const state = store[stateKey] || emptyState();

  useEffect(() => { saveStore(store); }, [store]);

  const update = (mutator: (s: AnnotationState) => AnnotationState) => {
    setStore(prev => ({ ...prev, [stateKey]: mutator(prev[stateKey] || emptyState()) }));
  };

  const setValue = (key: string, val: any) =>
    update(s => ({ ...s, values: { ...s.values, [key]: val } }));

  const visibleFields = lib.fields.filter(f => !f.perspectives || f.perspectives.includes(perspective));

  const labelFor = (f: FieldDef) => {
    const ov = f.labelOverride;
    if (ov) {
      if (audience === "toc" && ov.toc) return ov.toc[lang];
      if (perspective === "production" && ov.production) return ov.production[lang];
      if (perspective === "commercial" && ov.commercial) return ov.commercial[lang];
      if (audience === "tob" && ov.tob) return ov.tob[lang];
    }
    return f.label[lang];
  };

  const handleAddCustomOption = () => {
    if (!addDialog || !addDialog.name.trim()) return;
    const { field, name } = addDialog;
    update(s => ({
      ...s,
      customOptions: { ...s.customOptions, [field]: [...(s.customOptions[field] || []), name.trim()] },
    }));
    setAddDialog(null);
  };

  const handleAddCustomTag = () => {
    if (!newCustomTag.trim()) return;
    update(s => ({ ...s, customTags: [...s.customTags, newCustomTag.trim()] }));
    setNewCustomTag("");
    setCustomTagDialog(false);
  };

  const removeCustomTag = (tag: string) =>
    update(s => ({ ...s, customTags: s.customTags.filter(x => x !== tag) }));

  const handleSubmit = () => {
    const payload = {
      library: lib.key,
      image_id: currentImageId,
      perspective,
      audience,
      language: lang,
      annotations: state.values,
      custom_tags: state.customTags,
      custom_options: state.customOptions,
      timestamp: new Date().toISOString(),
    };
    console.log("[ANNOTATION SUBMIT]", payload);
    console.log(JSON.stringify(payload, null, 2));
    toast.success(t.submitted);
  };

  const handleSave = () => { saveStore(store); toast.success(t.saved); };

  const renderField = (f: FieldDef) => {
    const val = state.values[f.key];
    const baseOptions = f.options || [];
    const customOpts = state.customOptions[f.key] || [];
    const allOptions = [...baseOptions, ...customOpts.map(v => ({ value: v, hint: undefined as string | undefined }))];

    const labelEl = (
      <div className="flex items-center gap-2 mb-2">
        <Label className="text-sm font-semibold">{labelFor(f)}</Label>
        {f.allowCustom && (
          <button
            onClick={() => setAddDialog({ field: f.key, name: "" })}
            className="h-5 w-5 rounded-full bg-primary-soft text-primary flex items-center justify-center hover:bg-primary hover:text-primary-foreground transition"
            title={t.addOption}
          >
            <Plus className="h-3 w-3" />
          </button>
        )}
      </div>
    );

    switch (f.kind) {
      case "fixed-single":
        return (
          <div key={f.key}>
            {labelEl}
            <div className="flex flex-wrap gap-2">
              {allOptions.map(o => {
                const active = val === o.value;
                return (
                  <button key={o.value}
                    onClick={() => setValue(f.key, active ? "" : o.value)}
                    className={`px-3 py-1.5 rounded-full text-sm border transition ${
                      active
                        ? "bg-primary text-primary-foreground border-primary shadow"
                        : "bg-card border-border hover:border-primary/50"
                    }`}>
                    {o.value}
                  </button>
                );
              })}
            </div>
          </div>
        );
      case "fixed-multi": {
        const arr: string[] = Array.isArray(val) ? val : [];
        return (
          <div key={f.key}>
            {labelEl}
            <div className="flex flex-wrap gap-2">
              {allOptions.map(o => {
                const active = arr.includes(o.value);
                return (
                  <button key={o.value}
                    onClick={() => setValue(f.key, active ? arr.filter(x => x !== o.value) : [...arr, o.value])}
                    className={`px-3 py-1.5 rounded-full text-sm border transition ${
                      active
                        ? "bg-accent text-accent-foreground border-accent shadow"
                        : "bg-card border-border hover:border-accent/50"
                    }`}>
                    {o.value}
                  </button>
                );
              })}
            </div>
          </div>
        );
      }
      case "reference-multi": {
        const arr: string[] = Array.isArray(val) ? val : [];
        return (
          <div key={f.key}>
            {labelEl}
            <div className="flex flex-wrap gap-2">
              {allOptions.map(o => {
                const active = arr.includes(o.value);
                return (
                  <div key={o.value} className="flex items-center gap-1">
                    <button
                      onClick={() => setValue(f.key, active ? arr.filter(x => x !== o.value) : [...arr, o.value])}
                      className={`px-3 py-1.5 rounded-full text-sm border transition ${
                        active
                          ? "bg-accent text-accent-foreground border-accent shadow"
                          : "bg-card border-border hover:border-accent/50"
                      }`}>
                      {o.value}
                    </button>
                    {o.hint && (
                      <button onClick={() => alert(`${o.value}：${o.hint}`)}
                        className="h-5 w-5 rounded-full text-muted-foreground hover:text-primary">
                        <Info className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      }
      case "free-text":
        return (
          <div key={f.key}>{labelEl}
            <Input value={val || ""} onChange={e => setValue(f.key, e.target.value)} />
          </div>
        );
      case "free-textarea":
        return (
          <div key={f.key}>{labelEl}
            <Textarea rows={3} value={val || ""} onChange={e => setValue(f.key, e.target.value)} />
          </div>
        );
      case "number":
        return (
          <div key={f.key}>{labelEl}
            <Input type="number" value={val ?? ""} onChange={e => setValue(f.key, e.target.value === "" ? "" : Number(e.target.value))} />
          </div>
        );
      case "weight-group": {
        const obj: Record<string, number> = val || {};
        return (
          <div key={f.key}>{labelEl}
            <div className="grid grid-cols-2 gap-4 p-4 rounded-lg bg-muted/40 border border-border">
              {f.weights!.map(w => {
                const v = obj[w.key] ?? 0;
                return (
                  <div key={w.key}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-medium">{w.label[lang]}</span>
                      <span className="text-primary font-mono">{v}%</span>
                    </div>
                    <Slider value={[v]} min={0} max={100} step={1}
                      onValueChange={([nv]) => setValue(f.key, { ...obj, [w.key]: nv })} />
                  </div>
                );
              })}
            </div>
          </div>
        );
      }
    }
  };

  const progressPct = 50;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Top bar */}
      <header className="h-16 border-b border-border bg-card px-6 flex items-center gap-6 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary to-accent" />
          <h1 className="font-semibold text-lg">{t.appTitle}</h1>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{t.currentLib}:</span>
          <Select value={libKey} onValueChange={setLibKey}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {LIBRARIES.map(l => (
                <SelectItem key={l.key} value={l.key}>{l.name[lang]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="text-sm text-muted-foreground">
          {t.taskId}: <span className="font-mono text-foreground">TASK-2026-0042</span>
        </div>

        <div className="flex-1 flex items-center gap-3 max-w-xs">
          <span className="text-sm text-muted-foreground">{t.progress}</span>
          <Progress value={progressPct} className="flex-1" />
          <span className="text-sm font-mono">{progressPct}%</span>
        </div>

        <Button variant="outline" onClick={handleSave}><Save className="h-4 w-4 mr-1" />{t.save}</Button>
        <Button onClick={handleSubmit}><Send className="h-4 w-4 mr-1" />{t.submit}</Button>
      </header>

      <main className="flex-1 grid grid-cols-12 gap-4 p-4 overflow-hidden">
        {/* LEFT: image */}
        <section className="col-span-4 xl:col-span-3">
          <Card className="h-full p-4 flex flex-col">
            {lib.hasImage ? (
              <>
                <div className="flex-1 rounded-lg bg-muted overflow-hidden relative group">
                  <img
                    src={MOCK_IMAGES[imgIdx].url}
                    alt="annotation target"
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                  />
                  <div className="absolute top-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded">
                    {MOCK_IMAGES[imgIdx].id} · {t.hover}
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  {MOCK_IMAGES.map((m, i) => (
                    <button key={m.id} onClick={() => setImgIdx(i)}
                      className={`h-14 w-14 rounded-md overflow-hidden border-2 transition ${
                        i === imgIdx ? "border-primary" : "border-transparent opacity-70"
                      }`}>
                      <img src={m.url} className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
                <div className="flex justify-between mt-3">
                  <Button variant="outline" size="sm" disabled={imgIdx === 0} onClick={() => setImgIdx(i => i - 1)}>
                    <ChevronLeft className="h-4 w-4" />{t.prev}
                  </Button>
                  <Button variant="outline" size="sm" disabled={imgIdx === MOCK_IMAGES.length - 1} onClick={() => setImgIdx(i => i + 1)}>
                    {t.next}<ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col">
                <div className="flex-1 rounded-lg bg-muted/50 border-2 border-dashed border-border flex items-center justify-center text-muted-foreground mb-3">
                  {t.noImage}
                </div>
                <Label className="text-sm font-semibold mb-2">{t.commentInput}</Label>
                <Input value={commentImageId} onChange={e => setCommentImageId(e.target.value || "comment_001")}
                  placeholder="comment_001" />
              </div>
            )}
          </Card>
        </section>

        {/* CENTER: form */}
        <section className="col-span-5 xl:col-span-6 overflow-auto">
          <Card className="p-6 space-y-6">
            <div className="flex items-baseline justify-between">
              <h2 className="text-xl font-bold">{lib.name[lang]}</h2>
              <span className="text-xs text-muted-foreground font-mono">{currentImageId}</span>
            </div>
            {visibleFields.map(renderField)}
          </Card>
        </section>

        {/* RIGHT: aux */}
        <aside className="col-span-3 space-y-4 overflow-auto">
          <Card className="p-4 space-y-4">
            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">{t.perspective}</Label>
              <div className="flex gap-2 mt-2">
                {(["production","commercial"] as Perspective[]).map(p => (
                  <button key={p} onClick={() => setPerspective(p)}
                    className={`flex-1 px-3 py-2 rounded-md text-sm border transition ${
                      perspective === p ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border"
                    }`}>
                    {p === "production" ? t.production : t.commercial}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">{t.audience}</Label>
              <div className="flex gap-2 mt-2">
                {(["tob","toc"] as Audience[]).map(a => (
                  <button key={a} onClick={() => setAudience(a)}
                    className={`flex-1 px-3 py-2 rounded-md text-sm border transition ${
                      audience === a ? "bg-accent text-accent-foreground border-accent" : "bg-card border-border"
                    }`}>
                    {a.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">{t.language}</Label>
              <div className="flex gap-2 mt-2">
                {(["zh","en"] as Lang[]).map(l => (
                  <button key={l} onClick={() => setLang(l)}
                    className={`flex-1 px-3 py-2 rounded-md text-sm border transition ${
                      lang === l ? "bg-foreground text-background border-foreground" : "bg-card border-border"
                    }`}>
                    {l === "zh" ? "中文" : "English"}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <Label className="text-sm font-semibold">{t.customTags}</Label>
              <button onClick={() => setCustomTagDialog(true)}
                className="text-xs text-primary hover:underline">{t.addCustomTag}</button>
            </div>
            <div className="flex flex-wrap gap-2 min-h-[2rem]">
              {state.customTags.length === 0 && (
                <span className="text-xs text-muted-foreground">—</span>
              )}
              {state.customTags.map(tag => (
                <Badge key={tag} variant="secondary" className="gap-1">
                  {tag}
                  <button onClick={() => removeCustomTag(tag)}><X className="h-3 w-3" /></button>
                </Badge>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <button onClick={() => setHistoryOpen(o => !o)}
              className="flex items-center justify-between w-full text-sm font-semibold">
              <span className="flex items-center gap-2"><History className="h-4 w-4" />{t.history}</span>
              <ChevronRight className={`h-4 w-4 transition ${historyOpen ? "rotate-90" : ""}`} />
            </button>
            {historyOpen && (
              <ul className="mt-3 space-y-2 text-xs text-muted-foreground">
                <li className="flex justify-between"><span>2026-05-01 14:22</span><span>annotator_li</span></li>
                <li className="flex justify-between"><span>2026-04-29 10:08</span><span>annotator_wang</span></li>
                <li className="flex justify-between"><span>2026-04-22 16:45</span><span>annotator_chen</span></li>
              </ul>
            )}
          </Card>
        </aside>
      </main>

      {/* Add custom option dialog */}
      <Dialog open={!!addDialog} onOpenChange={o => !o && setAddDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t.addOption}</DialogTitle></DialogHeader>
          <Input autoFocus placeholder={t.inputNew}
            value={addDialog?.name || ""}
            onChange={e => setAddDialog(d => d ? { ...d, name: e.target.value } : d)}
            onKeyDown={e => e.key === "Enter" && handleAddCustomOption()} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialog(null)}>{t.cancel}</Button>
            <Button onClick={handleAddCustomOption}>{t.confirm}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={customTagDialog} onOpenChange={setCustomTagDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t.addCustomTag}</DialogTitle></DialogHeader>
          <Input autoFocus placeholder={t.inputNew} value={newCustomTag}
            onChange={e => setNewCustomTag(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleAddCustomTag()} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCustomTagDialog(false)}>{t.cancel}</Button>
            <Button onClick={handleAddCustomTag}>{t.confirm}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Index;
