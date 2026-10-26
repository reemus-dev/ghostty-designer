import {cn} from "cn";
import {Slider as SliderPrimitive} from "@base-ui/react/slider";

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  "aria-label": label,
  ...props
}: SliderPrimitive.Root.Props) {
  const initial = value ?? defaultValue;
  const thumbs = Array.isArray(initial) ? initial.length : 1;

  return (
    <SliderPrimitive.Root
      className={cn("data-horizontal:w-full data-vertical:h-full", className)}
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      thumbAlignment="edge"
      {...props}>
      <SliderPrimitive.Control className="relative flex w-full touch-none items-center select-none data-disabled:opacity-64 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative grow overflow-hidden rounded-full bg-input select-none data-horizontal:h-1 data-horizontal:w-full data-vertical:h-full data-vertical:w-1">
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className="bg-(--slider-range,var(--primary)) select-none data-horizontal:h-full data-vertical:w-full"
          />
        </SliderPrimitive.Track>
        {Array.from({length: thumbs}, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            aria-label={label}
            className="relative block size-4 shrink-0 rounded-full bg-foreground shadow-[0_1px_3px_rgb(0_0_0/50%),0_0_0_0.5px_rgb(0_0_0/40%)] transition-[scale] select-none after:absolute after:-inset-2 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 data-dragging:scale-110"
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export {Slider};
