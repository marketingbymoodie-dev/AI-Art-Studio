/**
 * What each art style wants from a truth and from a device.
 * The ten style prompt blocks stay in petposterousArtStyles.ts and are not copied here.
 * Fed to the truth writer and the device writer. Not a customer control.
 */
export type ArtStyleTextAppetite = "none" | "short" | "typography";

export type ArtStyleProfile = {
  styleId: string;
  /** Kind of truth this style draws well. Not a picture. */
  truthShape: string;
  textAppetite: ArtStyleTextAppetite;
  /** How many forms the graphic can carry and still read on a garment. */
  complexityCeiling: string;
  /** The one abstracted prop this style may ask the device for. */
  props: string;
};

export const ART_STYLE_PROFILES: Record<string, ArtStyleProfile> = {
  "conceptual-graphic": {
    styleId: "conceptual-graphic",
    truthShape: "A truth that collapses to one visual relationship. No text if the image can carry it.",
    textAppetite: "none",
    complexityCeiling: "Lowest. A few bold shapes, one relationship.",
    props: "Only the silhouette the relationship needs, such as a pillow shape.",
  },
  "bold-type": {
    styleId: "bold-type",
    truthShape: "A truth that wants a short punchy line. The image is secondary.",
    textAppetite: "typography",
    complexityCeiling: "The words are the structure. The pet is a small vignette inside them.",
    props: "None. The letterforms are the device.",
  },
  "pen-ink": {
    styleId: "pen-ink",
    truthShape: "One gesture or interaction. Sparse. Absurd scale works.",
    textAppetite: "short",
    complexityCeiling: "One gesture. Large open areas.",
    props: "One spare form, such as a seat shape, if the gesture needs it.",
  },
  woodcut: {
    styleId: "woodcut",
    truthShape: "Bold mass and silhouette. Attitude over detail.",
    textAppetite: "short",
    complexityCeiling: "One dominant mass. A second figure only as a sliver of negative space.",
    props: "One carved shape, such as a door, if the attitude needs a counterpart.",
  },
  "vintage-engraving": {
    styleId: "vintage-engraving",
    truthShape: "Absurd dignity. Scholarly seriousness applied to something ridiculous.",
    textAppetite: "short",
    complexityCeiling: "One dignified subject. Fine line, not a scene.",
    props: "None, unless a single emblem stands in for the dispute.",
  },
  "retro-character": {
    styleId: "retro-character",
    truthShape: "Personality and pose. The pet as a character actor.",
    textAppetite: "short",
    complexityCeiling: "One character, one attitude, readable as a tee graphic.",
    props: "At most one small prop that the character is acting with.",
  },
  "folk-graphic": {
    styleId: "folk-graphic",
    truthShape: "Charm and eccentricity.",
    textAppetite: "short",
    complexityCeiling: "Chunky shapes. One domestic note.",
    props: "Tolerates one domestic prop.",
  },
  ornamental: {
    styleId: "ornamental",
    truthShape: "A truth that can sit at the centre of decorative architecture.",
    textAppetite: "short",
    complexityCeiling: "The pet stays central. Ornament supports it.",
    props: "Botanical or ornamental forms, not a room.",
  },
  painterly: {
    styleId: "painterly",
    truthShape: "Affection and emotion rather than a gag.",
    textAppetite: "short",
    complexityCeiling: "Face and feeling. One gesture.",
    props: "None. The expression is the device.",
  },
  psychedelic: {
    styleId: "psychedelic",
    truthShape: "Exaggeration and a self-satisfied subject.",
    textAppetite: "short",
    complexityCeiling: "Warped forms around one subject. Still one idea.",
    props: "Forms may warp. Not a place.",
  },
};

export function artStyleProfile(styleId: string): ArtStyleProfile | undefined {
  return ART_STYLE_PROFILES[styleId];
}

/** A finished design a later tier can swap a pet into. Empty until a bench run earns an entry. */
export type ArtStyleLibraryEntry = {
  id: string;
  funnyTruth: string;
  punchline: string;
  device: string;
  styleId: string;
  productFamily: "apparel" | "poster" | "pillow";
  /** Behaviour and expression, not body shape. */
  petAgnosticNote: string;
};

export const ART_STYLE_LIBRARY: ArtStyleLibraryEntry[] = [];
