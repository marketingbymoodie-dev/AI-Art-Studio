import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { publicExperienceProfile } from "@shared/experienceProfile";
import { PETPOSTEROUS_EXPERIENCE_CONFIG } from "@shared/packs/petposterous";
import { getStylePackProfile } from "@shared/stylePackProfiles";
import { parseStyleInputCapabilities } from "@shared/stylePacks";
import { PackCreativeWizard } from "./PackCreativeWizard";
import type { PackCreativeState } from "./PackCreativeControls";

const pack = getStylePackProfile("petposterous")!;
const profile = publicExperienceProfile({ slug: "petposterous", stylePackId: "p", config: PETPOSTEROUS_EXPERIENCE_CONFIG }, {
  humorOptions: pack.humorOptions, relationshipOptions: pack.relationshipOptions, conceptWriter: true,
});
const initial: PackCreativeState = { petName: "", species: "", personality: [], humor: "witty", relationship: "its-complicated", wordsMode: "suggest", exactWords: "" };
function Harness({ start = 0 }: { start?: number }) {
  const [step, setStep] = useState(start);
  const [state, setState] = useState(initial);
  return <PackCreativeWizard profile={profile} capabilities={null} state={state} step={step} onStepChange={setStep}
    onChange={patch => setState(prev => ({ ...prev, ...patch }))} showingConcepts={false} onEditStory={() => setStep(0)} />;
}
afterEach(cleanup);

describe("Petposterous guided inputs", () => {
  it("shows one question, retains answers on Back and advances single choices", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Pet's name"), { target: { value: "Malcolm" } });
    expect(screen.queryByRole("button", { name: "Bossy" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Bossy" }));
    expect(screen.queryByLabelText("Pet's name")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect((screen.getByLabelText("Pet's name") as HTMLInputElement).value).toBe("Malcolm");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("button", { name: "Bossy" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Dry" }));
    expect(screen.getByRole("heading", { name: "You two are…" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Rivals" }));
    fireEvent.click(screen.getByRole("button", { name: "No words" }));
    expect(screen.getByRole("heading", { name: "Tell us what they do…" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: "No words" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("requires valid exact words before leaving that step", () => {
    render(<Harness start={4} />);
    fireEvent.click(screen.getByRole("button", { name: "My words" }));
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Your words"), { target: { value: "one two three four five six seven" } });
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Your words"), { target: { value: "HE HEARD YOU." } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Tell us what they do…" })).toBeTruthy();
  });

  it("skips unsupported questions and collapses controls after concepts", () => {
    const onStepChange = vi.fn();
    const props = { profile, capabilities: parseStyleInputCapabilities({ humor: { supported: false }, relationship: { supported: false } }),
      state: initial, step: 1, onStepChange, onChange: vi.fn(), showingConcepts: false, onEditStory: vi.fn() };
    const view = render(<PackCreativeWizard {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onStepChange).toHaveBeenCalledWith(4);
    view.rerender(<PackCreativeWizard {...props} showingConcepts state={{ ...initial, petName: "Malcolm" }} />);
    expect(screen.queryByTestId("petposterous-creative-wizard")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit answers" }));
    expect(props.onEditStory).toHaveBeenCalledOnce();
  });
});
