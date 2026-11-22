import { useRef, useCallback } from "react";
import type { ProductAdapter, ControlsProps, MockupProps } from "../BaseDesigner";
import { ZoomControls } from "../ZoomControls";
import { SafeZoneMask } from "../SafeZoneMask";
import { SizeSelector } from "../SizeSelector";
import { FrameColorSelector } from "../FrameColorSelector";
import type { ImageTransform } from "../types";

function PillowControls({
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
        label="Pillow Size"
        mintedCatalog={mintedCatalog}
        selectedColorName={color?.name}
        selectedColorId={color?.id}
      />

      {variants.length > 0 && (
        <FrameColorSelector
          frameColors={variants}
          selectedFrameColor={selectedVariant}
          onFrameColorChange={setSelectedVariant}
          colorLabel="Style"
          mintedCatalog={mintedCatalog}
          selectedSizeName={sizeName}
        />
      )}
    </div>
  );
}

function PillowMockup({
  imageUrl,
  transform,
  setTransform,
  printShape,
  canvasConfig,
  selectedVariant,
  variants,
  showSafeZone,
}: MockupProps) {
  const isCircular = printShape === "circle";
  const isSquare = printShape === "square" || (canvasConfig && canvasConfig.width === canvasConfig.height);
  
  const currentVariant = variants.find(v => v.id === selectedVariant);
  const pillowBackground = currentVariant?.hex || "#f5f5f5";
  
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!imageUrl) return;
      e.preventDefault();
      e.stopPropagation();
      isDraggingRef.current = true;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      containerRef.current = e.currentTarget;
    },
    [imageUrl]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current || !containerRef.current) return;
      e.preventDefault();
      e.stopPropagation();

      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      if (dx === 0 && dy === 0) return;

      const deltaX = (dx / rect.width) * 100;
      const deltaY = (dy / rect.height) * 100;

      setTransform({
        ...transform,
        x: Math.max(-50, Math.min(150, transform.x + deltaX)),
        y: Math.max(-50, Math.min(150, transform.y + deltaY)),
      });
      dragStartRef.current = { x: e.clientX, y: e.clientY };
    },
    [transform, setTransform]
  );

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
    containerRef.current = null;
  }, []);

  if (!imageUrl) {
    return (
      <div className="flex items-center justify-center p-8 text-muted-foreground">
        Generate a design to see preview
      </div>
    );
  }

  const width = canvasConfig?.width || 1;
  const height = canvasConfig?.height || 1;

  return (
    <div className="flex flex-col gap-4 w-full p-4">
      <div className="relative mx-auto">
        <div 
          className={`relative ${isCircular ? 'rounded-full' : 'rounded-lg'} ${imageUrl ? 'cursor-move' : ''}`}
          style={{
            boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
            overflow: "hidden",
            width: isSquare ? "300px" : width > height ? "360px" : "280px",
            aspectRatio: `${width}/${height}`,
            backgroundColor: pillowBackground,
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <div 
            className="absolute inset-0"
            style={{
              background: "linear-gradient(135deg, rgba(255,255,255,0.1) 0%, transparent 50%, rgba(0,0,0,0.1) 100%)",
              pointerEvents: "none",
              zIndex: 2,
            }}
          />
          
          <div 
            className={`relative w-full h-full ${isCircular ? 'rounded-full' : ''}`}
            style={{
              overflow: "hidden",
              position: "relative",
            }}
          >
            <img
              src={imageUrl}
              alt="Pillow design"
              className="absolute select-none"
              style={{
                width: `${transform.scale}%`,
                height: `${transform.scale}%`,
                objectFit: "cover",
                left: `${transform.x}%`,
                top: `${transform.y}%`,
                transform: "translate(-50%, -50%)",
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
          
          <div 
            className={`absolute inset-0 pointer-events-none ${isCircular ? 'rounded-full' : 'rounded-lg'}`}
            style={{
              border: "3px solid rgba(200,200,200,0.3)",
              boxShadow: "inset 0 2px 10px rgba(0,0,0,0.1)",
            }}
          />
        </div>
      </div>

      <div className="text-center">
        <span className="text-xs text-muted-foreground">
          {isCircular ? "Round Pillow" : isSquare ? "Square Pillow" : "Rectangular Pillow"}
          {currentVariant ? ` - ${currentVariant.name}` : ""} - Drag to reposition
        </span>
      </div>

      <ZoomControls
        transform={transform}
        onTransformChange={setTransform}
      />
    </div>
  );
}

export const PillowAdapter: ProductAdapter = {
  renderControls: (props) => <PillowControls {...props} />,
  renderMockup: (props) => <PillowMockup {...props} />,
  getDefaultTransform: () => ({ scale: 100, x: 50, y: 50 }),
};
