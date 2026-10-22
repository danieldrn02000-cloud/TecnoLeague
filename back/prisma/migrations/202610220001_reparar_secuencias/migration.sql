-- Solo contadores: no borra filas, no reinicia IDs ni modifica el catálogo.
-- Mismo orden de bloqueos en el script y la migración para evitar deadlocks.
DO $$
DECLARE
  tabla text;
  secuencia text;
  maximo bigint;
  ultimo bigint;
BEGIN
  FOREACH tabla IN ARRAY ARRAY[
    'categorias', 'detalle_intento', 'detalle_pedido', 'eventos_estado_pedido',
    'eventos_pago', 'movimientos_inventario', 'pagos', 'pedidos', 'productos',
    'tokens_recuperacion', 'usuarios'
  ] LOOP
    EXECUTE format('LOCK TABLE %I IN SHARE ROW EXCLUSIVE MODE', tabla);
    SELECT pg_get_serial_sequence(format('%I', tabla), 'id') INTO secuencia;
    IF secuencia IS NOT NULL THEN
      EXECUTE format('SELECT COALESCE(MAX(id), 0) FROM %I', tabla) INTO maximo;
      EXECUTE format('SELECT last_value FROM %s', secuencia::regclass) INTO ultimo;
      -- Nunca retrocede una secuencia, incluso si se borraron filas.
      PERFORM setval(secuencia::regclass, GREATEST(maximo, ultimo, 1), true);
    END IF;
  END LOOP;
END $$;
