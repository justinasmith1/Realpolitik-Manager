import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type Modifier,
  type ScreenReaderInstructions,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Columns3Icon, GripVerticalIcon, RotateCcwIcon } from 'lucide-react';
import { useRef, type ReactNode, type Ref } from 'react';

import { reorderVisibleIds, toggleVisibleId } from '@/components/data-table/columnPreferences';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface ColumnPickerItem<Id extends string> {
  id: Id;
  label: string;
}

export interface ColumnPickerProps<Id extends string> {
  /** Columnas configurables. Las ocultas se listan en este orden. */
  items: readonly ColumnPickerItem<Id>[];
  /** Visibles, en el orden en que se muestran. */
  visibleIds: readonly Id[];
  onVisibleIdsChange: (ids: Id[]) => void;
  onReset: () => void;
  /** Sin personalización "Restablecer" queda deshabilitado (no se oculta: el panel no salta). */
  isCustomized: boolean;
  /** Aclaración sobre las columnas que no se pueden ocultar, p. ej. cuáles son. */
  fixedColumnsNote?: ReactNode;
}

// Solo se arrastra en vertical: la lista es una columna y no hay a dónde ir de costado.
const soloVertical: Modifier = ({ transform }) => ({ ...transform, x: 0 });

const seDesmonto = (target: EventTarget | null) => target instanceof Node && !target.isConnected;

const instrucciones: ScreenReaderInstructions = {
  draggable:
    'Para reordenar, presioná Espacio o Enter. Mové la columna con las flechas arriba y abajo y ' +
    'presioná Espacio o Enter para soltarla, o Escape para cancelar.',
};

/**
 * Elige qué columnas opcionales de una tabla se ven y en qué orden. No sabe de qué tabla se trata
 * ni dónde se guarda la elección: recibe las columnas y avisa cada cambio.
 *
 * Las visibles se reordenan arrastrando su manija (también con teclado); las ocultas van debajo,
 * sin manija. Mostrar una la agrega al final de las visibles.
 */
export function ColumnPicker<Id extends string>({
  items,
  visibleIds,
  onVisibleIdsChange,
  onReset,
  isCustomized,
  fixedColumnsNote,
}: ColumnPickerProps<Id>) {
  const sensors = useSensors(
    // Con algunos píxeles de margen, un clic en la manija no se toma como arrastre.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Escape durante un arrastre con teclado lo cancela; no tiene que cerrar además el panel. El
  // panel ve la tecla primero: no se cierra y la deja seguir hasta dnd-kit, que escucha en el
  // documento. Se apaga un instante después del fin del arrastre por si el orden fuera el inverso.
  const arrastrando = useRef(false);
  const terminarArrastre = () => {
    setTimeout(() => {
      arrastrando.current = false;
    });
  };

  // Al mostrar u ocultar, la fila pasa de una lista a la otra y se vuelve a montar: el foco sigue
  // a su checkbox en la nueva posición en vez de perderse.
  const enfocarAlMontar = useRef<Id | null>(null);
  const refDeCheckbox = (id: Id) => (elemento: HTMLElement | null) => {
    if (elemento !== null && enfocarAlMontar.current === id) {
      enfocarAlMontar.current = null;
      elemento.focus();
    }
  };

  const alternar = (id: Id) => {
    enfocarAlMontar.current = id;
    onVisibleIdsChange(toggleVisibleId(visibleIds, id));
  };

  const alSoltar = ({ active, over }: DragEndEvent) => {
    terminarArrastre();
    if (over === null || active.id === over.id) return;
    onVisibleIdsChange(reorderVisibleIds(visibleIds, String(active.id), String(over.id)));
  };

  const etiqueta = new Map<UniqueIdentifier, string>(items.map((item) => [item.id, item.label]));
  const labelDe = (id: UniqueIdentifier) => etiqueta.get(id) ?? String(id);
  const posicionDe = (id: UniqueIdentifier) =>
    `${visibleIds.findIndex((visible) => visible === id) + 1} de ${visibleIds.length}`;
  const anuncios: Announcements = {
    onDragStart: ({ active }) =>
      `Tomaste ${labelDe(active.id)}, posición ${posicionDe(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over === null
        ? `${labelDe(active.id)} está fuera de la lista.`
        : `${labelDe(active.id)} pasa a la posición ${posicionDe(over.id)}.`,
    onDragEnd: ({ active, over }) =>
      over === null
        ? `Soltaste ${labelDe(active.id)} fuera de la lista: no cambió el orden.`
        : `Soltaste ${labelDe(active.id)} en la posición ${posicionDe(over.id)}.`,
    onDragCancel: ({ active }) => `Se canceló el movimiento de ${labelDe(active.id)}.`,
  };

  const visibles = visibleIds.flatMap((id) => items.filter((item) => item.id === id));
  const ocultas = items.filter((item) => !visibleIds.includes(item.id));

  return (
    <Popover
      onOpenChange={(open, detalles) => {
        if (open) return;
        if (detalles.reason === 'escape-key' && arrastrando.current) {
          detalles.cancel();
          detalles.allowPropagation();
        }
        // Al alternar, la fila con foco se desmonta para pasar a la otra lista: el navegador lo
        // informa como foco que sale del panel. No es la persona yéndose (el foco va al checkbox en
        // su nueva fila), así que no se cierra.
        if (detalles.reason === 'focus-out' && seDesmonto(detalles.event.target)) {
          detalles.cancel();
        }
      }}
    >
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        <Columns3Icon aria-hidden="true" />
        Columnas
      </PopoverTrigger>
      <PopoverContent>
        <div className="mb-2 flex items-baseline justify-between gap-3 px-1.5">
          <PopoverTitle>Columnas visibles</PopoverTitle>
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            <span aria-hidden="true">
              {visibleIds.length}/{items.length}
            </span>
            <span className="sr-only">
              {visibleIds.length} de {items.length}
            </span>
          </span>
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[soloVertical]}
          accessibility={{ announcements: anuncios, screenReaderInstructions: instrucciones }}
          onDragStart={() => {
            arrastrando.current = true;
          }}
          onDragEnd={alSoltar}
          onDragCancel={terminarArrastre}
        >
          <SortableContext items={[...visibleIds]} strategy={verticalListSortingStrategy}>
            {visibles.length > 0 && (
              <ul aria-label="Visibles, en orden" className="flex flex-col">
                {visibles.map((item) => (
                  <ColumnaVisible
                    key={item.id}
                    id={item.id}
                    label={item.label}
                    checkboxRef={refDeCheckbox(item.id)}
                    onToggle={() => alternar(item.id)}
                  />
                ))}
              </ul>
            )}
          </SortableContext>
        </DndContext>

        {ocultas.length > 0 && (
          <ul
            aria-label="Ocultas"
            className={cn('flex flex-col', visibles.length > 0 && 'mt-1.5 border-t pt-1.5')}
          >
            {ocultas.map((item) => (
              <li key={item.id} className="flex items-center gap-0.5">
                {/* Mismo ancho que la manija, para que los checkboxes queden alineados. */}
                <span aria-hidden="true" className="size-7 shrink-0" />
                <AlternarColumna
                  label={item.label}
                  checked={false}
                  checkboxRef={refDeCheckbox(item.id)}
                  onToggle={() => alternar(item.id)}
                />
              </li>
            ))}
          </ul>
        )}

        {fixedColumnsNote !== undefined && (
          <p className="mt-2 px-1.5 text-xs text-content-secondary">{fixedColumnsNote}</p>
        )}

        <div className="mt-2 border-t pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            // Deshabilitado sigue siendo enfocable: si el foco está en el botón al restablecer,
            // no se pierde (y el panel no se cierra) cuando pasa a deshabilitado. Así no lleva el
            // atributo `disabled`, por eso el estilo va por `data-disabled`.
            disabled={!isCustomized}
            focusableWhenDisabled
            className="data-disabled:pointer-events-none data-disabled:opacity-50"
            onClick={onReset}
          >
            <RotateCcwIcon aria-hidden="true" />
            Restablecer
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ColumnaVisible({
  id,
  label,
  checkboxRef,
  onToggle,
}: {
  id: string;
  label: string;
  checkboxRef: Ref<HTMLElement>;
  onToggle: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, attributes: { roleDescription: 'reordenable' } });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'flex items-center gap-0.5 rounded-md bg-popover',
        isDragging && 'relative z-10 shadow-sm ring-1 ring-foreground/10',
      )}
    >
      {/* La manija es el único lugar desde donde se arrastra: el resto de la fila alterna. */}
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Reordenar ${label}`}
        className="flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30 active:cursor-grabbing"
      >
        <GripVerticalIcon aria-hidden="true" className="size-4" />
      </button>
      <AlternarColumna label={label} checked checkboxRef={checkboxRef} onToggle={onToggle} />
    </li>
  );
}

function AlternarColumna({
  label,
  checked,
  checkboxRef,
  onToggle,
}: {
  label: string;
  checked: boolean;
  checkboxRef: Ref<HTMLElement>;
  onToggle: () => void;
}) {
  return (
    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-sm hover:bg-muted">
      <Checkbox ref={checkboxRef} checked={checked} onCheckedChange={onToggle} />
      <span className="truncate">{label}</span>
    </label>
  );
}
