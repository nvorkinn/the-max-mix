import QtQuick
import QtQuick.Controls.Basic

Button {
    id: control

    property bool primary: false

    implicitHeight: 56
    implicitWidth: Math.max(120, contentItem.implicitWidth + 40)
    font.pixelSize: 22

    contentItem: Text {
        text: control.text
        font: control.font
        color: control.enabled ? "#e6ebe6" : "#5c655c"
        horizontalAlignment: Text.AlignHCenter
        verticalAlignment: Text.AlignVCenter
    }

    background: Rectangle {
        radius: 10
        color: !control.enabled ? "#1c211c" : control.down ? "#256339" : control.primary ? "#2f7a49" : "#262c26"
    }
}
