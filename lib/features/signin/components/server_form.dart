import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

import '../../../state/sign_in.dart';
import '../../../theme/tokens.dart';
import '../../../ui/button.dart';
import '../../../ui/drawer.dart';
import '../../../ui/sheet.dart';
import '../../../ui/text_field.dart';

/// Add / edit a server, in a tablet's drawer (design 1o): Address (required), Name (optional), Cancel / Add (Save).
class ServerForm extends StatelessWidget {
  const ServerForm({
    super.key,
    required this.adding,
    required this.address,
    required this.name,
    required this.onCancel,
    required this.onSave,
    this.drawer = true,
  });

  // A tablet's drawer (its header with ✕), or a phone's sheet (a heading)
  final bool drawer;

  final bool adding;
  final TextEditingController address;
  final TextEditingController name;
  final VoidCallback onCancel;
  final VoidCallback onSave;

  @override
  Widget build(BuildContext context) {
    Widget label(String text) => Padding(
      padding: const EdgeInsets.only(top: 14, bottom: 6),
      child: Text(text, style: inter(12, color: Nocturne.textAlpha(60))),
    );
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (drawer)
          PanelHeader(
            title: adding ? 'Add server' : 'Edit server',
            onClose: onCancel,
          )
        else
          SheetHeading(adding ? 'Add server' : 'Edit server'),
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              label('Address'),
              CoveTextField(
                controller: address,
                placeholder: 'https://cove.local:9999',
                keyboardType: TextInputType.url,
                autofocus: true,
                textInputAction: TextInputAction.next,
              ),
              label('Name (optional)'),
              CoveTextField(
                controller: name,
                placeholder: 'e.g. Living Room NAS',
                textInputAction: TextInputAction.done,
                onSubmitted: (_) => onSave(),
              ),
              const SizedBox(height: 10),
              Text(
                'The address you open Cove at in a browser. Without a name, '
                'the list shows its host.',
                style: inter(12, color: Nocturne.textAlpha(50), height: 18),
              ),
              const SizedBox(height: 16),
              ValueListenableBuilder(
                valueListenable: address,
                builder: (context, value, _) => Row(
                  children: [
                    CoveButton(
                      label: 'Cancel',
                      variant: ButtonVariant.secondary,
                      size: ButtonSize.lg,
                      onPressed: onCancel,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: CoveButton(
                        label: adding ? 'Add' : 'Save',
                        size: ButtonSize.lg,
                        disabled: normalizeAddress(value.text).isEmpty,
                        onPressed: onSave,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
