import QtQuick
import QtQuick.Controls.Basic

TextField {
    id: control

    implicitHeight: 56
    font.pixelSize: 24
    leftPadding: 16
    rightPadding: 16
    color: "#e6ebe6"
    placeholderTextColor: "#6b756b"
    selectionColor: "#2f7a49"
    inputMethodHints: Qt.ImhNoAutoUppercase | Qt.ImhNoPredictiveText

    background: Rectangle {
        radius: 10
        color: "#0d0f0d"
        border.width: 2
        border.color: control.activeFocus ? "#3a8a55" : "#3a423a"
    }
}
