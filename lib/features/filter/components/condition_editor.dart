import 'dart:async';

import 'package:flutter/material.dart'
    show TextField, InputDecoration, InputBorder, OutlineInputBorder;
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

import '../../../api/cove_client.dart';
import '../../../theme/tokens.dart';
import '../../../ui/button.dart';
import '../../../ui/chips.dart';
import '../../../ui/icon_button.dart';
import '../../../ui/icons.dart';
import '../../../ui/misc.dart';
import '../../../ui/pressable.dart';
import '../../../utils/format.dart';
import '../model.dart';
import 'folder_browser.dart';

const _quickDates = ['-7d', '-1m', '-1y', '0d'];

/// The editor of one condition: pick a field (new conditions), then its operator and value; a path condition picks a
/// folder (3a, 3b, 3d). It fills its parent: a page in the tablet's filter drawer (9c / 9d), a tall sheet on a phone.
/// Every step has a back ([onCancel] from the first one).
class ConditionEditor extends StatefulWidget {
  const ConditionEditor({
    super.key,
    required this.client,
    required this.onSave,
    required this.onCancel,
    this.condition,
  });

  final CoveClient client;

  /// The condition to edit; none: a new one, starting with the field list
  final Condition? condition;
  final ValueChanged<Condition> onSave;
  final VoidCallback onCancel;

  @override
  State<ConditionEditor> createState() => _ConditionEditorState();
}

enum _Folders { browse, type, noAccess }

class _ConditionEditorState extends State<ConditionEditor> {
  late Condition? _condition = widget.condition;
  _Folders? _folders;
  // A value field's text while it is being typed (numbers stay text until saved)
  bool _tried = false;

  void _set(Condition Function(Condition c) change) =>
      setState(() => _condition = change(_condition!));

  void _pickFolder(FolderPick pick) {
    final folder = pick.chain.lastOrNull;
    if (folder != null) {
      _set(
        (c) => c.copyWith(
          value: folder.path,
          folder: (chain: pick.chain, subfolders: pick.subfolders),
        ),
      );
    }
    setState(() => _folders = null);
  }

  void _save() {
    final c = _condition;
    if (c == null) return;
    if (validate(c) != null) {
      setState(() => _tried = true);
      return;
    }
    final f = fieldById(c.field);
    final numeric =
        f.type == FieldType.duration ||
        f.type == FieldType.rating ||
        f.type == FieldType.number;
    num toNum(Object? v) => v is num ? v : num.parse('$v');
    widget.onSave(
      numeric
          ? Condition(
              id: c.id,
              field: c.field,
              modifier: c.modifier,
              value: toNum(c.value),
              value2: c.value2 == null || '${c.value2}'.isEmpty
                  ? null
                  : toNum(c.value2),
              names: c.names,
              folder: c.folder,
            )
          : c,
    );
  }

  @override
  Widget build(BuildContext context) {
    final c = _condition;
    final changeField = widget.condition != null
        ? widget.onCancel
        : () => setState(() => _condition = null);
    final Widget body;
    if (c == null) {
      body = _FieldList(
        onPick: (id) => setState(() => _condition = newCondition(id)),
        onBack: widget.onCancel,
      );
    } else if (_folders == _Folders.browse) {
      body = FolderBrowser(
        client: widget.client,
        start: c.folder?.chain ?? const [],
        onPick: _pickFolder,
        onBack: () => setState(() => _folders = null),
        onType: (noAccess) => setState(
          () => _folders = noAccess ? _Folders.noAccess : _Folders.type,
        ),
      );
    } else if (_folders != null) {
      body = TypedPath(
        client: widget.client,
        noAccess: _folders == _Folders.noAccess,
        initial: '${c.value}',
        onPick: _pickFolder,
        onBack: () => setState(
          () =>
              _folders = _folders == _Folders.noAccess ? null : _Folders.browse,
        ),
      );
    } else if (fieldById(c.field).type == FieldType.path) {
      body = _PathEditor(
        client: widget.client,
        condition: c,
        set: _set,
        onBrowse: () => setState(() => _folders = _Folders.browse),
        onBack: changeField,
      );
    } else {
      body = _Editor(
        client: widget.client,
        condition: c,
        set: _set,
        onBack: changeField,
      );
    }
    final error = c == null ? null : validate(c);
    return CallbackShortcuts(
      bindings: {
        const SingleActivator(LogicalKeyboardKey.escape): widget.onCancel,
      },
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(child: body),
          if (c != null && _folders == null)
            Container(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 16),
              decoration: BoxDecoration(
                border: Border(top: BorderSide(color: Nocturne.divider)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                spacing: 8,
                children: [
                  if (error != null && _tried) ErrorText(error),
                  // Still pressable: pressing says what is missing
                  Opacity(
                    opacity: error != null ? 0.45 : 1,
                    child: CoveButton(
                      label: widget.condition != null
                          ? 'Save condition'
                          : 'Add condition',
                      size: ButtonSize.lg,
                      onPressed: _save,
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// A step's header: ‹ and the title.
class EditorHeader extends StatelessWidget {
  const EditorHeader({
    super.key,
    required this.title,
    required this.onBack,
    this.trailing,
  });

  final String title;
  final VoidCallback? onBack;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(8, 10, 12, 4),
    child: Row(
      children: [
        if (onBack != null)
          CoveIconButton(
            icon: Phosphor.caretLeft,
            onPressed: onBack!,
            semanticLabel: 'Back',
            iconSize: 20,
          ),
        if (onBack == null) const SizedBox(width: 12),
        const SizedBox(width: 4),
        Expanded(
          child: Text(
            title,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: inter(17, weight: medium),
          ),
        ),
        ?trailing,
      ],
    ),
  );
}

/// A section's label: small, uppercase, muted.
class SectionLabel extends StatelessWidget {
  const SectionLabel(this.text, {super.key, this.top = 14});

  final String text;
  final double top;

  @override
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.only(top: top, bottom: 8),
    child: Text(
      text.toUpperCase(),
      style: inter(11.5, color: Nocturne.textAlpha(50), letterSpacing: 0.9),
    ),
  );
}

class _FieldList extends StatelessWidget {
  const _FieldList({required this.onPick, required this.onBack});

  final ValueChanged<String> onPick;
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      EditorHeader(title: 'Add a condition', onBack: onBack),
      Expanded(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
          children: [
            for (final section in fieldSections) ...[
              SectionLabel(section),
              for (final f in fields.where((f) => f.section == section))
                Pressable(
                  onPressed: () => onPick(f.id),
                  semanticLabel: f.label,
                  builder: (context, states) => Container(
                    height: 44,
                    padding: const EdgeInsets.symmetric(horizontal: 10),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(Nocturne.radiusMd),
                      color: states.pressed || states.highlighted
                          ? Nocturne.textAlpha(6)
                          : null,
                    ),
                    child: Row(
                      children: [
                        Expanded(child: Text(f.label, style: inter(15))),
                        Icon(
                          Phosphor.caretRight,
                          size: 14,
                          color: Nocturne.textAlpha(45),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ],
        ),
      ),
    ],
  );
}

class _Editor extends StatelessWidget {
  const _Editor({
    required this.client,
    required this.condition,
    required this.set,
    required this.onBack,
  });

  final CoveClient client;
  final Condition condition;
  final void Function(Condition Function(Condition c)) set;
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    final f = fieldById(condition.field);
    String operatorLabel(Modifier m) =>
        m == Modifier.equals && f.type == FieldType.bool
        ? 'is'
        : modifierLabels[m]!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        EditorHeader(title: f.label, onBack: onBack),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
            children: [
              if (f.modifiers.length > 1) ...[
                const SectionLabel('Operator'),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    for (final m in f.modifiers)
                      ChoiceChip(
                        label: operatorLabel(m),
                        on: condition.modifier == m,
                        onPressed: () => set((c) => c.copyWith(modifier: m)),
                      ),
                  ],
                ),
              ],
              if (needsValue(condition.modifier)) ...[
                const SectionLabel('Value', top: 18),
                _ValueEditor(client: client, condition: condition, set: set),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _ValueEditor extends StatelessWidget {
  const _ValueEditor({
    required this.client,
    required this.condition,
    required this.set,
  });

  final CoveClient client;
  final Condition condition;
  final void Function(Condition Function(Condition c)) set;

  @override
  Widget build(BuildContext context) {
    final f = fieldById(condition.field);
    final two = needsTwoValues(condition.modifier);
    Widget chips(List<Widget> children) =>
        Wrap(spacing: 6, runSpacing: 6, children: children);
    Widget and() => Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Text('and', style: inter(13, color: Nocturne.textAlpha(55))),
    );
    switch (f.type) {
      case FieldType.multiId:
        return _EntityPicker(client: client, condition: condition, set: set);
      case FieldType.resolution:
        return chips([
          for (final r in resolutions)
            ChoiceChip(
              label: r.label,
              on: condition.value == r.value,
              onPressed: () => set((c) => c.copyWith(value: r.value)),
            ),
        ]);
      case FieldType.orientation:
        return chips([
          for (final o in orientations)
            ChoiceChip(
              label: o.label,
              on: condition.value == o.value,
              onPressed: () => set((c) => c.copyWith(value: o.value)),
            ),
        ]);
      case FieldType.bool:
        return chips([
          ChoiceChip(
            label: 'Yes',
            on: condition.value == true,
            onPressed: () => set((c) => c.copyWith(value: true)),
          ),
          ChoiceChip(
            label: 'No',
            on: condition.value == false,
            onPressed: () => set((c) => c.copyWith(value: false)),
          ),
        ]);
      case FieldType.rating:
        Widget stars(bool second) => chips([
          for (var s = 1; s <= 5; s++)
            ChoiceChip(
              label: '$s★',
              on:
                  num.tryParse(
                    '${second ? condition.value2 : condition.value}',
                  ) ==
                  s,
              onPressed: () => set(
                (c) => second ? c.copyWith(value2: s) : c.copyWith(value: s),
              ),
            ),
        ]);
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            stars(false),
            if (two) ...[and(), stars(true)],
          ],
        );
      case FieldType.date || FieldType.timestamp:
        return _DateValues(condition: condition, set: set, two: two);
      case FieldType.duration || FieldType.number:
        final unit = f.type == FieldType.duration ? 'min' : null;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            ValueField(
              key: ValueKey('${condition.id}-1'),
              initial: '${condition.value}',
              numeric: true,
              unit: unit,
              onChanged: (t) => set((c) => c.copyWith(value: t)),
            ),
            if (two) ...[
              and(),
              ValueField(
                key: ValueKey('${condition.id}-2'),
                initial: '${condition.value2 ?? ''}',
                numeric: true,
                unit: unit,
                onChanged: (t) => set((c) => c.copyWith(value2: t)),
              ),
            ],
          ],
        );
      default:
        final regex =
            condition.modifier == Modifier.matchesRegex ||
            condition.modifier == Modifier.notMatchesRegex;
        return ValueField(
          key: ValueKey('${condition.id}-text'),
          initial: '${condition.value}',
          placeholder: regex ? 'A regular expression' : 'Text',
          onChanged: (t) => set((c) => c.copyWith(value: t)),
        );
    }
  }
}

/// A value's text field: 46 tall on the ground, mono for paths and dates, a unit after numbers.
class ValueField extends StatefulWidget {
  const ValueField({
    super.key,
    required this.initial,
    required this.onChanged,
    this.placeholder,
    this.numeric = false,
    this.mono = false,
    this.unit,
    this.onFocus,
    this.autofocus = false,
    this.controller,
  });

  final String initial;
  final ValueChanged<String> onChanged;
  final String? placeholder;
  final bool numeric;
  final bool mono;
  final String? unit;
  final VoidCallback? onFocus;
  final bool autofocus;
  final TextEditingController? controller;

  @override
  State<ValueField> createState() => _ValueFieldState();
}

class _ValueFieldState extends State<ValueField> {
  late final _controller =
      widget.controller ?? TextEditingController(text: widget.initial);
  final _focus = FocusNode();

  @override
  void initState() {
    super.initState();
    _focus.addListener(() {
      if (_focus.hasFocus) widget.onFocus?.call();
    });
  }

  @override
  void dispose() {
    if (widget.controller == null) _controller.dispose();
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final style = widget.mono ? mono(14) : inter(15, height: 18);
    OutlineInputBorder outline(Color color) => OutlineInputBorder(
      borderRadius: BorderRadius.circular(Nocturne.radiusMd),
      borderSide: BorderSide(color: color),
    );
    return TextField(
      controller: _controller,
      focusNode: _focus,
      autofocus: widget.autofocus,
      autocorrect: false,
      enableSuggestions: false,
      keyboardType: widget.numeric
          ? const TextInputType.numberWithOptions(decimal: true)
          : TextInputType.text,
      onChanged: widget.onChanged,
      cursorColor: Nocturne.accent,
      style: style,
      decoration: InputDecoration(
        isDense: true,
        filled: true,
        fillColor: Nocturne.bg,
        hintText: widget.placeholder,
        hintStyle: style.copyWith(color: Nocturne.textAlpha(40)),
        suffixText: widget.unit,
        suffixStyle: inter(14, color: Nocturne.textAlpha(55)),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 14,
          vertical: 14,
        ),
        enabledBorder: outline(Nocturne.divider),
        focusedBorder: outline(Nocturne.accent),
        border: outline(Nocturne.divider),
      ),
    );
  }
}

class _DateValues extends StatefulWidget {
  const _DateValues({
    required this.condition,
    required this.set,
    required this.two,
  });

  final Condition condition;
  final void Function(Condition Function(Condition c)) set;
  final bool two;

  @override
  State<_DateValues> createState() => _DateValuesState();
}

class _DateValuesState extends State<_DateValues> {
  bool _second = false;
  late final _first = TextEditingController(text: '${widget.condition.value}');
  late final _secondText = TextEditingController(
    text: '${widget.condition.value2 ?? ''}',
  );

  @override
  void dispose() {
    _first.dispose();
    _secondText.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final current = _second ? widget.condition.value2 : widget.condition.value;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ValueField(
          initial: '',
          controller: _first,
          mono: true,
          placeholder: '-1y or 2025-10-04',
          onFocus: () => setState(() => _second = false),
          onChanged: (t) => widget.set((c) => c.copyWith(value: t)),
        ),
        if (widget.two) ...[
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Text('and', style: inter(13, color: Nocturne.textAlpha(55))),
          ),
          ValueField(
            initial: '',
            controller: _secondText,
            mono: true,
            placeholder: '0d or 2025-10-04',
            onFocus: () => setState(() => _second = true),
            onChanged: (t) => widget.set((c) => c.copyWith(value2: t)),
          ),
        ],
        const SizedBox(height: 10),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            for (final d in _quickDates)
              ChoiceChip(
                label: d,
                on: current == d,
                onPressed: () {
                  (_second ? _secondText : _first).text = d;
                  widget.set(
                    (c) =>
                        _second ? c.copyWith(value2: d) : c.copyWith(value: d),
                  );
                },
              ),
          ],
        ),
        Padding(
          padding: const EdgeInsets.only(top: 10),
          child: Text(
            'Relative dates count from now: -7d is a week ago, -1y3m a year and three months ago, 0d today.',
            style: inter(12, color: Nocturne.textAlpha(50), height: 18),
          ),
        ),
      ],
    );
  }
}

class _EntityPicker extends StatefulWidget {
  const _EntityPicker({
    required this.client,
    required this.condition,
    required this.set,
  });

  final CoveClient client;
  final Condition condition;
  final void Function(Condition Function(Condition c)) set;

  @override
  State<_EntityPicker> createState() => _EntityPickerState();
}

class _EntityPickerState extends State<_EntityPicker> {
  final _q = TextEditingController();
  List<Named> _results = const [];
  bool _loading = true;
  Timer? _timer;
  int _asked = 0;

  Field get _field => fieldById(widget.condition.field);

  @override
  void initState() {
    super.initState();
    _search();
    _q.addListener(() {
      _timer?.cancel();
      _timer = Timer(const Duration(milliseconds: 250), _search);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _q.dispose();
    super.dispose();
  }

  Future<void> _search() async {
    final asked = ++_asked;
    setState(() => _loading = true);
    try {
      final items = await widget.client.lookup(_field.lookup!.name, _q.text);
      if (!mounted || asked != _asked) return;
      setState(() {
        _results = items;
        _loading = false;
      });
    } catch (_) {
      if (mounted && asked == _asked) setState(() => _loading = false);
    }
  }

  void _toggle(Named item) {
    final selected = widget.condition.ids;
    final on = selected.contains(item.id);
    widget.set(
      (c) => c.copyWith(
        value: on
            ? [
                for (final id in selected)
                  if (id != item.id) id,
              ]
            : [...selected, item.id],
        names: {...c.names, item.id: item.name},
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final selected = widget.condition.ids;
    final names = widget.condition.names;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      spacing: 10,
      children: [
        if (selected.isNotEmpty)
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final id in selected)
                Pressable(
                  onPressed: () => _toggle(Named(id, names[id] ?? '#$id')),
                  semanticLabel: 'Remove ${names[id] ?? '#$id'}',
                  builder: (context, states) => Container(
                    height: 34,
                    padding: const EdgeInsets.only(left: 12, right: 8),
                    decoration: BoxDecoration(
                      color: Nocturne.accent800,
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      spacing: 6,
                      children: [
                        Text(
                          names[id] ?? '#$id',
                          style: inter(13.5, color: Nocturne.accent100),
                        ),
                        const Icon(
                          Phosphor.x,
                          size: 13,
                          color: Nocturne.accent100,
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        Container(
          height: 42,
          padding: const EdgeInsets.symmetric(horizontal: 12),
          decoration: BoxDecoration(
            color: Nocturne.bg,
            borderRadius: BorderRadius.circular(Nocturne.radiusMd),
            border: Border.all(color: Nocturne.divider),
          ),
          child: Row(
            spacing: 8,
            children: [
              Icon(
                Phosphor.magnifyingGlass,
                size: 16,
                color: Nocturne.textAlpha(55),
              ),
              Expanded(
                child: TextField(
                  controller: _q,
                  autocorrect: false,
                  cursorColor: Nocturne.accent,
                  style: inter(14.5, height: 18),
                  decoration: InputDecoration(
                    isDense: true,
                    border: InputBorder.none,
                    contentPadding: EdgeInsets.zero,
                    hintText: 'Search ${_field.label.toLowerCase()}s',
                    hintStyle: inter(
                      14.5,
                      height: 18,
                      color: Nocturne.textAlpha(40),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
        if (_loading && _results.isEmpty)
          Text('Searching…', style: inter(13, color: Nocturne.textAlpha(50)))
        else if (_results.isEmpty)
          Text(
            'Nothing found.',
            style: inter(13, color: Nocturne.textAlpha(50)),
          )
        else
          Column(
            children: [
              for (final item in _results)
                Pressable(
                  onPressed: () => _toggle(item),
                  semanticLabel: item.name,
                  builder: (context, states) {
                    final on = selected.contains(item.id);
                    return Container(
                      height: 42,
                      padding: const EdgeInsets.symmetric(horizontal: 10),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(Nocturne.radiusMd),
                        color: states.highlighted || states.pressed
                            ? Nocturne.textAlpha(6)
                            : null,
                      ),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text(
                              item.name,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: inter(
                                14.5,
                                color: on ? Nocturne.accent200 : Nocturne.text,
                              ),
                            ),
                          ),
                          if (on)
                            const Icon(
                              Phosphor.check,
                              size: 16,
                              color: Nocturne.accent,
                            ),
                        ],
                      ),
                    );
                  },
                ),
            ],
          ),
      ],
    );
  }
}

/// Design 3a: a path condition. "In folder" / "Not in folder" pick a library folder (the folder and everything inside
/// it); "Contains text" and "Regex" match the path as text.
class _PathEditor extends StatefulWidget {
  const _PathEditor({
    required this.client,
    required this.condition,
    required this.set,
    required this.onBrowse,
    required this.onBack,
  });

  final CoveClient client;
  final Condition condition;
  final void Function(Condition Function(Condition c)) set;
  final VoidCallback onBrowse;
  final VoidCallback onBack;

  @override
  State<_PathEditor> createState() => _PathEditorState();
}

class _PathEditorState extends State<_PathEditor> {
  int? _count;
  Timer? _timer;
  String _counted = '';

  @override
  void initState() {
    super.initState();
    _recount();
  }

  @override
  void didUpdateWidget(_PathEditor old) {
    super.didUpdateWidget(old);
    _recount();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  void _recount() {
    final c = widget.condition;
    final key = '${c.modifier.name}|${c.value}';
    if (key == _counted) return;
    _counted = key;
    _timer?.cancel();
    _count = null;
    if (validate(c) != null) return;
    _timer = Timer(const Duration(milliseconds: 300), () async {
      try {
        final n = await widget.client.countMatching(
          filter: {
            'operator': 'AND',
            'children': [
              {
                'filter': {
                  'pathCriterion': {
                    'value': '${c.value}',
                    'modifier': c.modifier.name,
                  },
                },
              },
            ],
          },
        );
        if (mounted && key == _counted) setState(() => _count = n);
      } catch (_) {}
    });
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.condition;
    final f = fieldById(c.field);
    final folderMatch = isFolderMatch(c.modifier);
    final chain = c.folder?.chain ?? const <FolderRef>[];
    final names = (chain.length > 1 ? chain.sublist(1) : chain)
        .map((x) => x.name)
        .toList();
    final value = '${c.value}';
    if (names.isEmpty && value.isNotEmpty) {
      names.addAll(
        value
            .split(RegExp(r'[\\/]'))
            .where((p) => p.isNotEmpty)
            .toList()
            .reversed
            .take(2)
            .toList()
            .reversed,
      );
    }
    final subfolders = c.folder?.subfolders ?? 0;
    final last = names.lastOrNull;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        EditorHeader(title: f.label, onBack: widget.onBack),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
            children: [
              const SectionLabel('Match'),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  for (final m in f.modifiers)
                    ChoiceChip(
                      label: pathLabels[m]!,
                      icon: m == Modifier.underPath ? Phosphor.folder : null,
                      on: c.modifier == m,
                      height: 40,
                      onPressed: () => widget.set(
                        // Between folder and text matches the value means something else: start over.
                        (c) => isFolderMatch(m) == folderMatch
                            ? c.copyWith(modifier: m)
                            : c.copyWith(
                                modifier: m,
                                value: '',
                                clearFolder: true,
                              ),
                      ),
                    ),
                ],
              ),
              if (folderMatch) ...[
                const SectionLabel('Folder', top: 20),
                Pressable(
                  onPressed: widget.onBrowse,
                  semanticLabel: value.isEmpty
                      ? 'Choose a folder'
                      : 'Change the folder',
                  builder: (context, states) => Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(Nocturne.radiusLg),
                      color: value.isEmpty
                          ? Nocturne.surface
                          : Color.alphaBlend(
                              Nocturne.accentAlpha(9),
                              Nocturne.surface,
                            ),
                      border: Border.all(
                        color: value.isEmpty
                            ? Nocturne.divider
                            : Nocturne.accent,
                      ),
                      boxShadow: value.isEmpty
                          ? null
                          : [
                              BoxShadow(
                                color: Nocturne.accentAlpha(22),
                                blurRadius: 24,
                              ),
                            ],
                    ),
                    child: Row(
                      spacing: 12,
                      children: [
                        Container(
                          width: 40,
                          height: 40,
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            color: Nocturne.accentAlpha(14),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Icon(
                            value.isEmpty
                                ? Phosphor.folder
                                : Phosphor.fill(Phosphor.folder),
                            size: 20,
                            color: Nocturne.accent,
                          ),
                        ),
                        Expanded(
                          child: value.isEmpty
                              ? Text(
                                  'Choose a folder',
                                  style: inter(15, weight: medium),
                                )
                              : Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  spacing: 2,
                                  children: [
                                    Wrap(
                                      crossAxisAlignment:
                                          WrapCrossAlignment.center,
                                      children: [
                                        for (final (i, name)
                                            in names.indexed) ...[
                                          if (i > 0)
                                            Padding(
                                              padding:
                                                  const EdgeInsets.symmetric(
                                                    horizontal: 3,
                                                  ),
                                              child: Icon(
                                                Phosphor.caretRight,
                                                size: 11,
                                                color: Nocturne.textAlpha(45),
                                              ),
                                            ),
                                          Text(
                                            name,
                                            style: inter(15, weight: medium),
                                          ),
                                        ],
                                      ],
                                    ),
                                    Text(
                                      value,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: mono(
                                        12,
                                        color: Nocturne.accent300,
                                      ),
                                    ),
                                  ],
                                ),
                        ),
                        Text(
                          value.isEmpty ? 'Browse' : 'Change',
                          style: inter(13.5, color: Nocturne.accent300),
                        ),
                      ],
                    ),
                  ),
                ),
                if (value.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 10),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      spacing: 8,
                      children: [
                        Icon(
                          Phosphor.treeStructure,
                          size: 15,
                          color: Nocturne.textAlpha(45),
                        ),
                        Expanded(
                          child: Text(
                            subfolders > 0
                                ? 'Includes everything inside it: $last and its $subfolders subfolder${subfolders == 1 ? '' : 's'}.'
                                : 'Includes everything inside ${last ?? 'it'}.',
                            style: inter(
                              12.5,
                              color: Nocturne.textAlpha(55),
                              height: 18,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
              ] else ...[
                SectionLabel(
                  c.modifier == Modifier.matchesRegex ? 'Pattern' : 'Text',
                  top: 20,
                ),
                ValueField(
                  key: ValueKey('${c.id}-${c.modifier.name}'),
                  initial: value,
                  mono: true,
                  placeholder: c.modifier == Modifier.matchesRegex
                      ? 'A regular expression'
                      : 'Part of the file path',
                  onChanged: (t) => widget.set((c) => c.copyWith(value: t)),
                ),
              ],
              if (validate(c) == null) ...[
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 16),
                  child: Rule(),
                ),
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'With this condition',
                        style: inter(13, color: Nocturne.textAlpha(60)),
                      ),
                    ),
                    Text(
                      _count == null ? '…' : '${formatCount(_count!)} videos',
                      style: inter(13, weight: medium),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

/// A frame for the editor as a phone's tall sheet: back closes, the sheet's height fixed so its steps don't jump.
class EditorSheetFrame extends StatelessWidget {
  const EditorSheetFrame({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) =>
      SizedBox(height: MediaQuery.sizeOf(context).height * 0.85, child: child);
}
