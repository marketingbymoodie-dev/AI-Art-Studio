import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ExperienceChoice, PublicExperienceProfile } from "@shared/experienceProfile";
import type { StyleInputCapabilities } from "@shared/stylePacks";
import { choiceLabel, type PackCreativeState } from "./PackCreativeControls";

const TITLES = ["Who's the star?", "What are they like?", "What's your kind of humour?", "You two are…", "Words on the artwork?", "Tell us what they do…"];

/** Progress lives in the embed so opening a mobile sheet preserves the current question. */
export function PackCreativeWizard({ profile, capabilities, state, onChange, step, onStepChange, showingConcepts, onEditStory }: {
  profile: PublicExperienceProfile;
  capabilities: StyleInputCapabilities | null;
  state: PackCreativeState;
  onChange: (patch: Partial<PackCreativeState>) => void;
  step: number;
  onStepChange: (step: number) => void;
  showingConcepts: boolean;
  onEditStory: () => void;
}) {
  const id = useId();
  const c = profile.controls;
  const steps = [0, ...(c.personality ? [1] : []),
    ...((capabilities?.humor.supported ?? true) && c.humorOptions?.length ? [2] : []),
    ...((capabilities?.relationship.supported ?? true) && c.relationshipOptions?.length ? [3] : []),
    ...(c.words ? [4] : []), 5];
  const current = steps.includes(step) ? step : steps[0];
  const index = steps.indexOf(current);
  const next = () => onStepChange(steps[index + 1] ?? 5);
  const exactWordsValid = state.wordsMode !== "exact" ||
    (state.exactWords.trim().length > 0 && state.exactWords.trim().split(/\s+/).length <= 6);
  const choices = (options: ExperienceChoice[], selected: string[], toggle: (value: string) => void) => (
    <div className="grid grid-cols-2 gap-2">
      {options.map(option => <button key={option.id} type="button" aria-pressed={selected.includes(option.id)}
        onClick={() => toggle(option.id)}
        className={`min-h-11 rounded-md border px-3 py-2 text-left text-sm transition-colors ${selected.includes(option.id) ? "border-foreground bg-foreground text-background" : "border-border bg-background hover:bg-muted"}`}>
        {option.label}
      </button>)}
    </div>
  );

  if (showingConcepts) return (
    <div className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3" data-testid="petposterous-story-summary">
      <p className="text-sm truncate">{state.petName.trim() || "Your pet"}{state.species ? ` · ${choiceLabel(c.species?.options, state.species)}` : ""}</p>
      <button type="button" onClick={onEditStory} className="shrink-0 text-sm underline">Edit answers</button>
    </div>
  );

  return <section className="rounded-lg border p-4 space-y-4" aria-labelledby={`${id}-title`} data-testid="petposterous-creative-wizard">
    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>Make it theirs</span><span>Step {index + 1} of {steps.length}</span>
    </div>
    <div className="flex gap-1" aria-hidden="true">{steps.map((s, i) => <div key={s} className={`h-1 flex-1 rounded-full ${i <= index ? "bg-foreground" : "bg-muted"}`} />)}</div>
    <h2 id={`${id}-title`} className="text-lg font-semibold" aria-live="polite" aria-atomic="true">{TITLES[current]}</h2>
    <div key={current} className="space-y-3 animate-in fade-in slide-in-from-right-2 duration-200 motion-reduce:animate-none">
      {current === 0 ? <>
        {c.petName ? <div className="space-y-1.5"><Label htmlFor={`${id}-name`}>{c.petName.label}</Label>
          <Input id={`${id}-name`} value={state.petName} maxLength={40} placeholder={c.petName.placeholder}
            onChange={e => onChange({ petName: e.target.value })} /></div> : null}
        {c.species ? <div className="space-y-1.5"><Label htmlFor={`${id}-species`}>{c.species.label}</Label>
          <select id={`${id}-species`} value={state.species} onChange={e => onChange({ species: e.target.value })}
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm">
            <option value="">Choose a pet type</option>{c.species.options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select></div> : null}
      </> : null}
      {current === 1 && c.personality ? <>
        <p className="text-sm text-muted-foreground">Pick up to {c.personality.max}. A couple is plenty.</p>
        {choices(c.personality.options, state.personality, value => {
          if (state.personality.includes(value)) onChange({ personality: state.personality.filter(p => p !== value) });
          else if (state.personality.length < c.personality!.max) onChange({ personality: [...state.personality, value] });
        })}
      </> : null}
      {current === 2 ? choices(c.humorOptions ?? [], [state.humor], value => { onChange({ humor: value }); next(); }) : null}
      {current === 3 ? choices(c.relationshipOptions ?? [], [state.relationship], value => { onChange({ relationship: value }); next(); }) : null}
      {current === 4 ? <>
        {choices([{ id: "suggest", label: "Suggest some" }, { id: "exact", label: "My words" }, { id: "none", label: "No words" }], [state.wordsMode], value => {
          onChange({ wordsMode: value as PackCreativeState["wordsMode"] });
          if (value !== "exact") next();
        })}
        {state.wordsMode === "exact" ? <div className="space-y-1.5"><Label htmlFor={`${id}-words`}>Your words</Label>
          <Input id={`${id}-words`} value={state.exactWords} maxLength={60} placeholder="Up to 6 words, exactly as you want them"
            onChange={e => onChange({ exactWords: e.target.value })} />
          <p className="text-xs text-muted-foreground">Up to 6 words. We'll keep them exactly as written.</p>
        </div> : null}
      </> : null}
      {current === 5 ? <p className="text-sm text-muted-foreground">One real habit or moment. What happened, and what makes it so them?</p> : null}
    </div>
    <div className="flex justify-between gap-2 pt-1">
      <Button type="button" variant="ghost" disabled={index === 0} onClick={() => onStepChange(steps[index - 1])}>Back</Button>
      {current !== 5 ? <Button type="button" onClick={next} disabled={current === 4 && !exactWordsValid}>Next</Button> : null}
    </div>
  </section>;
}
