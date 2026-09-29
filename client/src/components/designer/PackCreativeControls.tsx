import type { CSSProperties } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ExperienceChoice, PublicExperienceProfile } from "@shared/experienceProfile";
import type { StyleInputCapabilities } from "@shared/stylePacks";
import type { WordsMode } from "@shared/creativeBrief";

/** Same chip language as the existing style sub-option pills (embed-design). */
function chipStyle(selected: boolean): CSSProperties {
  return {
    padding: "4px 12px",
    fontSize: 12,
    borderRadius: 9999,
    cursor: "pointer",
    fontWeight: selected ? 600 : 500,
    background: selected ? "#111827" : "transparent",
    color: selected ? "#ffffff" : "#374151",
    border: selected ? "2px solid #111827" : "1px solid #9ca3af",
  };
}

export function ChoiceChips({
  label,
  hint,
  choices,
  value,
  onToggle,
  testId,
}: {
  label: string;
  hint?: string;
  choices: ExperienceChoice[];
  value: string[];
  onToggle: (id: string) => void;
  testId: string;
}) {
  return (
    <div className="space-y-1" data-testid={testId}>
      <Label className="text-xs">
        {label}
        {hint ? <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">{hint}</span> : null}
      </Label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {choices.map((c) => {
          const selected = value.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              style={chipStyle(selected)}
              aria-pressed={selected}
              onClick={() => onToggle(c.id)}
              data-testid={`${testId}-${c.id}`}
            >
              {c.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export type PackCreativeState = {
  petName: string;
  species: string;
  personality: string[];
  humor: string;
  relationship: string;
  wordsMode: WordsMode;
  exactWords: string;
};

const WORDS_CHOICES: Array<{ id: WordsMode; label: string }> = [
  { id: "suggest", label: "Suggest some" },
  { id: "exact", label: "My words" },
  { id: "none", label: "No words" },
];

/**
 * Extra creative inputs for style-pack styles, driven entirely by the store's
 * experience profile controls + the style's declared capabilities.
 */
export function PackCreativeControls({
  profile,
  capabilities,
  state,
  onChange,
}: {
  profile: PublicExperienceProfile;
  capabilities: StyleInputCapabilities | null;
  state: PackCreativeState;
  onChange: (patch: Partial<PackCreativeState>) => void;
}) {
  const c = profile.controls;
  const humorOn = (capabilities?.humor.supported ?? true) && (c.humorOptions?.length ?? 0) > 0;
  const relationshipOn = (capabilities?.relationship.supported ?? true) && (c.relationshipOptions?.length ?? 0) > 0;
  return (
    <div className="space-y-3" data-testid="pack-creative-controls">
      {c.petName ? (
        <div className="space-y-1">
          <Label htmlFor="pack-pet-name" className="text-xs">{c.petName.label}</Label>
          <Input
            id="pack-pet-name"
            value={state.petName}
            maxLength={40}
            placeholder={c.petName.placeholder}
            onChange={(e) => onChange({ petName: e.target.value })}
            className="h-9 text-sm"
            data-testid="input-pack-pet-name"
          />
        </div>
      ) : null}
      {c.species ? (
        <ChoiceChips
          label={c.species.label}
          choices={c.species.options}
          value={state.species ? [state.species] : []}
          onToggle={(id) => onChange({ species: state.species === id ? "" : id })}
          testId="chips-pack-species"
        />
      ) : null}
      {c.personality ? (
        <ChoiceChips
          label={c.personality.label}
          hint={`(up to ${c.personality.max})`}
          choices={c.personality.options}
          value={state.personality}
          onToggle={(id) => {
            const has = state.personality.includes(id);
            if (has) onChange({ personality: state.personality.filter((p) => p !== id) });
            else if (state.personality.length < c.personality!.max) onChange({ personality: [...state.personality, id] });
          }}
          testId="chips-pack-personality"
        />
      ) : null}
      {humorOn ? (
        <ChoiceChips
          label={c.humor?.label ?? "Humour"}
          choices={c.humorOptions!}
          value={[state.humor]}
          onToggle={(id) => onChange({ humor: id })}
          testId="chips-pack-humor"
        />
      ) : null}
      {relationshipOn ? (
        <ChoiceChips
          label={c.relationship?.label ?? "Relationship"}
          choices={c.relationshipOptions!}
          value={[state.relationship]}
          onToggle={(id) => onChange({ relationship: id })}
          testId="chips-pack-relationship"
        />
      ) : null}
      {c.words ? (
        <div className="space-y-1">
          <ChoiceChips
            label={c.words.label}
            choices={WORDS_CHOICES}
            value={[state.wordsMode]}
            onToggle={(id) => onChange({ wordsMode: id as WordsMode })}
            testId="chips-pack-words"
          />
          {state.wordsMode === "exact" ? (
            <Input
              value={state.exactWords}
              maxLength={60}
              placeholder="Up to 6 words, exactly as you want them"
              onChange={(e) => onChange({ exactWords: e.target.value })}
              className="h-9 text-sm"
              data-testid="input-pack-exact-words"
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Label for an option id (for the concept writer and the brief). */
export function choiceLabel(choices: ExperienceChoice[] | undefined, id: string): string {
  return choices?.find((c) => c.id === id)?.label ?? "";
}
