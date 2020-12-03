import React, { useContext, useMemo, useEffect, useCallback } from 'react';
import { PositionScale } from '@visx/shape/lib/types';
import { scaleBand } from '@visx/scale';
import isChildWithProps from '../../../typeguards/isChildWithProps';
import { BaseBarSeriesProps } from './BaseBarSeries';
import {
  Bar,
  BarsProps,
  DataContextType,
  PointerEventParams,
  SeriesProps,
  TooltipContextType,
} from '../../../types';
import DataContext from '../../../context/DataContext';
import getScaleBandwidth from '../../../utils/getScaleBandwidth';
import getScaleBaseline from '../../../utils/getScaleBaseline';
import isValidNumber from '../../../typeguards/isValidNumber';
import { BARGROUP_EVENT_SOURCE, XYCHART_EVENT_SOURCE } from '../../../constants';
import usePointerEventEmitters from '../../../hooks/usePointerEventEmitters';
import usePointerEventHandlers from '../../../hooks/usePointerEventHandlers';
import TooltipContext from '../../../context/TooltipContext';

export type BaseBarGroupProps<
  XScale extends PositionScale,
  YScale extends PositionScale,
  Datum extends object
> = {
  /** `BarSeries` elements */
  children: JSX.Element | JSX.Element[];
  /** Group band scale padding, [0, 1] where 0 = no padding, 1 = no bar. */
  padding?: number;
  /** Comparator function to sort `dataKeys` within a bar group. By default the DOM rendering order of `BarGroup`s `children` is used. */
  sortBars?: (dataKeyA: string, dataKeyB: string) => number;
  /** Rendered component which is passed BarsProps by BaseBarGroup after processing. */
  BarsComponent: React.FC<BarsProps<XScale, YScale>>;
} & Pick<
  SeriesProps<XScale, YScale, Datum>,
  'onPointerMove' | 'onPointerOut' | 'onPointerUp' | 'pointerEvents'
>;

export default function BaseBarGroup<
  XScale extends PositionScale,
  YScale extends PositionScale,
  Datum extends object
>({
  children,
  padding = 0.1,
  sortBars,
  BarsComponent,
  onPointerMove: onPointerMoveProps,
  onPointerOut: onPointerOutProps,
  onPointerUp: onPointerUpProps,
  pointerEvents = true,
}: BaseBarGroupProps<XScale, YScale, Datum>) {
  const {
    colorScale,
    dataRegistry,
    horizontal,
    registerData,
    unregisterData,
    xScale,
    yScale,
  } = (useContext(DataContext) as unknown) as DataContextType<XScale, YScale, Datum>;

  const barSeriesChildren = useMemo(
    () =>
      React.Children.toArray(children).filter(child =>
        isChildWithProps<BaseBarSeriesProps<XScale, YScale, Datum>>(child),
      ),
    [children],
  ) as React.ReactElement<BaseBarSeriesProps<XScale, YScale, Datum>>[];

  // extract data keys from child series
  const dataKeys: string[] = useMemo(
    () => barSeriesChildren.map(child => child.props.dataKey ?? '').filter(key => key),
    [barSeriesChildren],
  );

  // register all child data
  useEffect(() => {
    const dataToRegister = barSeriesChildren.map(child => {
      const { dataKey: key, data, xAccessor, yAccessor } = child.props;
      return { key, data, xAccessor, yAccessor };
    });

    registerData(dataToRegister);
    return () => unregisterData(dataKeys);
  }, [registerData, unregisterData, barSeriesChildren, dataKeys]);

  // create group scale
  const groupScale = useMemo(
    () =>
      scaleBand<string>({
        domain: sortBars ? [...dataKeys].sort(sortBars) : dataKeys,
        range: [0, getScaleBandwidth(horizontal ? yScale : xScale)],
        padding,
      }),
    [sortBars, dataKeys, xScale, yScale, horizontal, padding],
  );

  const { showTooltip, hideTooltip } = (useContext(TooltipContext) ?? {}) as TooltipContextType<
    Datum
  >;
  const onPointerMove = useCallback(
    (p: PointerEventParams<Datum>) => {
      showTooltip(p);
      if (onPointerMoveProps) onPointerMoveProps(p);
    },
    [showTooltip, onPointerMoveProps],
  );
  const onPointerOut = useCallback(
    (event: React.PointerEvent) => {
      hideTooltip();
      if (onPointerOutProps) onPointerOutProps(event);
    },
    [hideTooltip, onPointerOutProps],
  );
  const ownEventSourceKey = `${BARGROUP_EVENT_SOURCE}-${dataKeys.join('-')}}`;
  const pointerEventEmitters = usePointerEventEmitters({
    source: ownEventSourceKey,
    onPointerMove: pointerEvents, // handle tooltip even if pointer prop isn't passed
    onPointerOut: pointerEvents,
    onPointerUp: !!onPointerUpProps && pointerEvents,
  });
  usePointerEventHandlers({
    dataKey: dataKeys,
    onPointerMove: pointerEvents ? onPointerMove : undefined,
    onPointerOut: pointerEvents ? onPointerOut : undefined,
    onPointerUp: pointerEvents ? onPointerUpProps : undefined,
    sources: [XYCHART_EVENT_SOURCE, ownEventSourceKey],
  });

  const xZeroPosition = useMemo(() => (xScale ? getScaleBaseline(xScale) : 0), [xScale]);
  const yZeroPosition = useMemo(() => (yScale ? getScaleBaseline(yScale) : 0), [yScale]);

  const registryEntries = dataKeys.map(key => dataRegistry.get(key));

  // if scales and data are not available in the registry, bail
  if (registryEntries.some(entry => entry == null) || !xScale || !yScale || !colorScale) {
    return null;
  }

  const barThickness = getScaleBandwidth(groupScale);

  const bars = registryEntries.flatMap(({ xAccessor, yAccessor, data, key }) => {
    const getLength = (d: Datum) =>
      horizontal
        ? (xScale(xAccessor(d)) ?? NaN) - xZeroPosition
        : (yScale(yAccessor(d)) ?? NaN) - yZeroPosition;

    const getGroupPosition = horizontal
      ? (d: Datum) => yScale(yAccessor(d)) ?? NaN
      : (d: Datum) => xScale(xAccessor(d)) ?? NaN;

    const withinGroupPosition = groupScale(key) ?? 0;

    const getX = horizontal
      ? (d: Datum) => xZeroPosition + Math.min(0, getLength(d))
      : (d: Datum) => getGroupPosition(d) + withinGroupPosition;

    const getY = horizontal
      ? (d: Datum) => getGroupPosition(d) + withinGroupPosition
      : (d: Datum) => yZeroPosition + Math.min(0, getLength(d));

    const getWidth = horizontal ? (d: Datum) => Math.abs(getLength(d)) : () => barThickness;
    const getHeight = horizontal ? () => barThickness : (d: Datum) => Math.abs(getLength(d));

    return data
      .map((bar, index) => {
        const barX = getX(bar);
        if (!isValidNumber(barX)) return null;
        const barY = getY(bar);
        if (!isValidNumber(barY)) return null;
        const barWidth = getWidth(bar);
        if (!isValidNumber(barWidth)) return null;
        const barHeight = getHeight(bar);
        if (!isValidNumber(barHeight)) return null;

        return {
          key: `${key}-${index}`,
          x: barX,
          y: barY,
          width: barWidth,
          height: barHeight,
          fill: colorScale(key),
        };
      })
      .filter(bar => bar) as Bar[];
  });

  return (
    <g className="visx-bar-group">
      <BarsComponent
        bars={bars}
        horizontal={horizontal}
        xScale={xScale}
        yScale={yScale}
        {...pointerEventEmitters}
      />
    </g>
  );
}
