import type { ProductAdapter, ControlsProps, MockupProps } from "../BaseDesigner";
import { ZoomControls } from "../ZoomControls";
import { SafeZoneMask } from "../SafeZoneMask";
import { SizeSelector } from "../SizeSelector";
import { FrameColorSelector } from "../FrameColorSelector";
import type { ImageTransform } from "../types";

function FramedPrintControls({
  selectedSize,
  setSelectedSize,
  selectedVariant,
  setSelectedVariant,
  sizes,
  variants,
  mintedCatalog,
}: ControlsProps) {
  const sizeName = sizes.find((s) => s.id === selectedSize)?.name;
  const color = variants.find((c) => c.id === selectedVariant);
  return (
    <div className="flex flex-col gap-4">
      <SizeSelector
        sizes={sizes}
        selectedSize={selectedSize}
        onSizeChange={setSelectedSize}
        label="Print Size"
        mintedCatalog={mintedCatalog}
        selectedColorName={color?.name}
        selectedColorId={color?.id}
      />
      {variants.length > 0 && (
        <FrameColorSelector
          frameColors={variants}
          selectedFrameColor={selectedVariant}
          onFrameColorChange={setSelectedVariant}
          colorLabel="Frame Color"
          mintedCatalog={mintedCatalog}
          selectedSizeName={sizeName}
        />
      )}
    </div>
  );
}

function FramedPrintMockup({
  imageUrl,
  transform,
  setTransform,
  printShape,
  canvasConfig,
  showSafeZone,
}: MockupProps) {
  if (!imageUrl) {
    return (
      <div className="flex items-center justify-center p-8 text-muted-foreground">
        Generate a design to see preview
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 w-full p-4">
      <div className="relative mx-auto w-full max-w-sm">
        <div
          className="relative overflow-hidden rounded-md bg-muted"
          style={{
            aspectRatio: canvasConfig ? `${canvasConfig.width}/${canvasConfig.height}` : "4/5",
          }}
        >
          <img
            src={imageUrl}
            alt="Generated artwork"
            className="absolute select-none inset-0 w-full h-full object-contain"
            style={{
              transform: `scale(${transform.scale / 100}) translate(${transform.x - 50}%, ${transform.y - 50}%)`,
              transformOrigin: "center center",
              pointerEvents: "none",
            }}
            draggable={false}
          />
          <SafeZoneMask
            shape={printShape}
            canvasConfig={canvasConfig}
            showMask={showSafeZone}
            className="absolute inset-0"
          />
        </div>
      </div>

      <ZoomControls
        transform={transform}
        onTransformChange={setTransform}
      />
    </div>
  );
}

export const FramedPrintAdapter: ProductAdapter = {
  renderControls: (props) => <FramedPrintControls {...props} />,
  renderMockup: (props) => <FramedPrintMockup {...props} />,
  getDefaultTransform: () => ({ scale: 100, x: 50, y: 50 }),
};
